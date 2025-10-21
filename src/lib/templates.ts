export type Template = { id: string; name: string; text: string }
export const builtinTemplates: Template[] = [
  { id:'basic-beat', name:'ビート→ショット', text:'[主語]\n[動作]\n[場所/時間]\n[カメラ/レンズ]\n[尺]\n[備考]' },
  { id:'dialog-2p', name:'対話（2人）', text:'【登場人物A】\nセリフ...\n【登場人物B】\nセリフ...\n[カメラ]\n[尺]' },
  { id:'action', name:'アクション', text:'[主語]\n[動作:激しめ]\n[場所/時間]\n[カメラ/レンズ:追従]\n[尺]\n[安全注意/スタント]' }
]
