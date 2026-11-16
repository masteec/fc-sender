export class GracefulShutdownHandler {
  private isStopping = false;
  private onShutdownCallback: () => Promise<void>;
  private readonly sigintListener: () => void;
  private readonly sigtermListener: () => void;

  constructor(onShutdownCallback: () => Promise<void>) {
    this.onShutdownCallback = onShutdownCallback;

    this.sigintListener = () => {
      void this.shutdown();
    };
    this.sigtermListener = () => {
      void this.shutdown();
    };

    process.on('SIGINT', this.sigintListener);
    process.on('SIGTERM', this.sigtermListener);
  }

  async shutdown(): Promise<void> {
    if (this.isStopping) return;
    this.isStopping = true;
    try {
      await this.onShutdownCallback();
    } catch (e) {
      console.error('Error durante el cierre limpio (shutdown):', e);
    }
  }

  shouldStop(): boolean {
    return this.isStopping;
  }

  dispose(): void {
    process.off('SIGINT', this.sigintListener);
    process.off('SIGTERM', this.sigtermListener);
  }
}
