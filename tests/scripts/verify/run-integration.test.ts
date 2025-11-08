import { runIntegrationVerify } from '../../scripts/verify/run-integration';
import { execSync } from 'node:child_process';

// Mock execSync to prevent actual command execution during tests
jest.mock('node:child_process', () => ({
  execSync: jest.fn(() => Buffer.from('mocked output')),
}));

describe('runIntegrationVerify', () => {
  beforeEach(() => {
    (execSync as jest.Mock).mockClear();
  });

  it('should return 0 in dry-run mode and report detected gates', () => {
    process.env.INTEGRATION_MODE = 'dry-run';
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    expect(runIntegrationVerify()).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith('Integrated gates detected (dry-run):', expect.any(String));
    consoleSpy.mockRestore();
  });

  it('should execute all available gate commands and return 0 on success', () => {
    process.env.INTEGRATION_MODE = ''; // Clear dry-run mode
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    // Mock package.json scripts for testing
    jest.spyOn(require('node:fs'), 'readFileSync').mockReturnValueOnce(JSON.stringify({
      scripts: {
        lint: 'echo lint',
        typecheck: 'echo typecheck',
        test: 'echo test',
        build: 'echo build',
      },
    }));

    expect(runIntegrationVerify()).toBe(0);
    expect(execSync).toHaveBeenCalledTimes(4);
    expect(execSync).toHaveBeenCalledWith('echo lint', expect.any(Object));
    expect(execSync).toHaveBeenCalledWith('echo typecheck', expect.any(Object));
    expect(execSync).toHaveBeenCalledWith('echo test', expect.any(Object));
    expect(execSync).toHaveBeenCalledWith('echo build', expect.any(Object));
    consoleSpy.mockRestore();
  });

  it('should stop on first failed gate and return 1', () => {
    process.env.INTEGRATION_MODE = ''; // Clear dry-run mode
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    // Mock package.json scripts for testing, with lint failing
    jest.spyOn(require('node:fs'), 'readFileSync').mockReturnValueOnce(JSON.stringify({
      scripts: {
        lint: 'exit 1',
        typecheck: 'echo typecheck',
      },
    }));
    (execSync as jest.Mock).mockImplementationOnce(() => { throw new Error('lint failed'); });

    expect(runIntegrationVerify()).toBe(1);
    expect(execSync).toHaveBeenCalledTimes(1);
    expect(execSync).toHaveBeenCalledWith('exit 1', expect.any(Object));
    expect(consoleSpy).toHaveBeenCalledWith('Gate lint failed');
    consoleSpy.mockRestore();
  });

  it('should return 1 if package.json cannot be loaded', () => {
    process.env.INTEGRATION_MODE = ''; // Clear dry-run mode
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(require('node:fs'), 'readFileSync').mockImplementationOnce(() => { throw new Error('file not found'); });

    expect(runIntegrationVerify()).toBe(1);
    expect(consoleSpy).toHaveBeenCalledWith('Integration verification failed to load configuration.');
    consoleSpy.mockRestore();
  });
});

