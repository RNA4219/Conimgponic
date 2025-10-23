import type {
  AutoSaveBridgeMessage,
  AutoSaveBridgePhase,
  AutoSavePhaseGuardSnapshot,
  AutoSaveStatusState
} from '../../src/lib/autosave'

export interface AutoSaveBridgeSequenceStep {
  readonly fromPhase: AutoSaveBridgePhase
  readonly message: AutoSaveBridgeMessage['type']
  readonly toPhase: AutoSaveBridgePhase
  readonly statusState?: AutoSaveStatusState
  readonly notes: readonly string[]
}

export interface AutoSaveBridgeIntegrationCase {
  readonly id: string
  readonly description: string
  readonly guard: AutoSavePhaseGuardSnapshot
  readonly expectedHistory: {
    readonly maxGenerations: number
    readonly maxBytes: number
  }
  readonly telemetry: readonly string[]
  readonly steps: readonly AutoSaveBridgeSequenceStep[]
  readonly assertions: readonly string[]
}

export const integrationCases: readonly AutoSaveBridgeIntegrationCase[] = [
  {
    id: 'roundtrip-dirty-saving-saved',
    description:
      'autosave.enabled=true + options.disabled=false の Phase ガードを通過し、dirty→saving→saved の往復を封筒型メッセージで保証する',
    guard: {
      featureFlag: { value: true, source: 'env' },
      optionsDisabled: false
    },
    expectedHistory: { maxGenerations: 20, maxBytes: 50 * 1024 * 1024 },
    telemetry: [
      'autosave.status(state=dirty→saving→saved)',
      'autosave.save(ok=true, retryable=false)'
    ],
    steps: [
      {
        fromPhase: 'bootstrap',
        message: 'bridge.bootstrap',
        toPhase: 'ready',
        notes: ['policy.debounceMs=500', 'policy.idleMs=2000', 'policy.maxGenerations=20', 'policy.maxBytes=52428800']
      },
      {
        fromPhase: 'ready',
        message: 'bridge.ready',
        toPhase: 'status.autosave',
        notes: ['accepted=true', 'Phase guard resolved via env > workspace > localStorage']
      },
      {
        fromPhase: 'status.autosave',
        message: 'status.autosave',
        toPhase: 'snapshot.request',
        statusState: 'dirty',
        notes: ['UI delta detected after debounce 500ms', 'pendingBytes captured before idle 2s']
      },
      {
        fromPhase: 'snapshot.request',
        message: 'snapshot.request',
        toPhase: 'status.autosave',
        notes: ['storyboard serialized once', 'tmp write prepared for atomic rename', 'guard.featureFlag.value=true']
      },
      {
        fromPhase: 'status.autosave',
        message: 'status.autosave',
        toPhase: 'snapshot.result',
        statusState: 'saving',
        notes: ['awaiting-lock→writing-current transition exposed', 'retryCount reset to 0']
      },
      {
        fromPhase: 'snapshot.result',
        message: 'snapshot.result',
        toPhase: 'status.autosave',
        notes: ['ok=true', 'generation incremented atomically', 'history FIFO enforced']
      },
      {
        fromPhase: 'status.autosave',
        message: 'status.autosave',
        toPhase: 'snapshot.request',
        statusState: 'saved',
        notes: ['lastSuccessAt updated', 'pendingBytes cleared', 'queuedGeneration released']
      }
    ],
    assertions: [
      'snapshot.result.ok=true の場合は status.autosave.state が dirty→saving→saved の順で発火する',
      'snapshot.request.payload.guard は Phase ガードの実効値とソース (env→workspace→localStorage→default) を保持する',
      'snapshot.result.ok=true で retainedBytes<=50MB かつ 世代数<=20 を保証する',
      'status.autosave.state="saving" の間は retryCount が 0、atomic write(tmp→rename) 中は reqId を固定する'
    ]
  },
  {
    id: 'phase-guard-blocks-snapshot',
    description:
      'autosave.enabled=false または AutoSaveOptions.disabled=true の場合に snapshot.request を抑止し、disabled 状態を維持する',
    guard: {
      featureFlag: { value: false, source: 'workspace' },
      optionsDisabled: true
    },
    expectedHistory: { maxGenerations: 20, maxBytes: 50 * 1024 * 1024 },
    telemetry: ['autosave.status(state=disabled)', 'autosave.guard(blocked=true)'],
    steps: [
      {
        fromPhase: 'bootstrap',
        message: 'bridge.bootstrap',
        toPhase: 'ready',
        notes: ['policy shared but guard blocked', 'optionsDisabled=true propagated']
      },
      {
        fromPhase: 'ready',
        message: 'bridge.ready',
        toPhase: 'status.autosave',
        notes: ['accepted=false', 'reason=phase-guard-blocked']
      },
      {
        fromPhase: 'status.autosave',
        message: 'status.autosave',
        toPhase: 'status.autosave',
        statusState: 'disabled',
        notes: ['UI keeps CTA disabled', 'no snapshot.request dispatched', 'lastSuccessAt unchanged']
      }
    ],
    assertions: [
      'bridge.ready.accepted=false の場合は snapshot.request メッセージが生成されない',
      'status.autosave.state="disabled" を継続送信し Phase ガード解除まで retryCount/pendingBytes を更新しない',
      'snapshot.result は {ok:false,error:{code:"disabled"}} を返し、telemetry autosave.guard(blocked=true) を 1 度だけ送る'
    ]
  }
] as const
