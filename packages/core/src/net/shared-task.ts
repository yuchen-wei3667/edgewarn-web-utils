/** One operation with independently cancellable subscribers. The last departure cancels its I/O. */
export class SharedTask<T> {
    private readonly controller = new AbortController();
    private users = 0;
    private settled = false;
    readonly promise: Promise<T>;

    constructor(load: (signal: AbortSignal) => Promise<T>) {
        this.promise = Promise.resolve().then(() => {
            this.controller.signal.throwIfAborted();
            return load(this.controller.signal);
        });
        void this.promise.then(
            () => {
                this.settled = true;
            },
            () => {
                this.settled = true;
            },
        );
    }

    get available(): boolean {
        return !this.controller.signal.aborted;
    }

    join(signal: AbortSignal): Promise<T> {
        signal.throwIfAborted();
        this.users++;
        return new Promise<T>((resolve, reject) => {
            let finished = false;
            const release = () => {
                if (finished) return false;
                finished = true;
                signal.removeEventListener('abort', abort);
                if (--this.users === 0 && !this.settled) this.controller.abort();
                return true;
            };
            const abort = () => {
                if (release()) reject(signal.reason);
            };
            signal.addEventListener('abort', abort, { once: true });
            void this.promise.then(
                (value) => {
                    if (release()) resolve(value);
                },
                (error) => {
                    if (release()) reject(error);
                },
            );
        });
    }
}
