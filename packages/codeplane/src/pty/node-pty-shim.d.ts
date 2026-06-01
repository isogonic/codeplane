declare module "@lydell/node-pty" {
  export function spawn(
    file: string,
    args: string[] | string,
    options: Record<string, any>,
  ): IPty

  export interface IPty {
    readonly pid: number
    readonly cols: number
    readonly rows: number
    readonly process: string
    handleFlowControl: boolean
    readonly onData: IEvent<string>
    readonly onExit: IEvent<{ exitCode: number; signal?: number }>
    resize(columns: number, rows: number): void
    clear(): void
    write(data: string | Buffer): void
    kill(signal?: string): void
    pause(): void
    resume(): void
  }

  export interface IEvent<T> {
    (listener: (e: T) => any): IDisposable
  }

  export interface IDisposable {
    dispose(): void
  }
}
