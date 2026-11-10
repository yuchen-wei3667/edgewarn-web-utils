/** An HTTP answer that was not a success; `status` decides whether a retry could help. */
export class ModelHttpError extends Error {
    readonly status: number;
    constructor(status: number, url: string) {
        super(`HTTP ${status} for ${url}`);
        this.status = status;
    }
}

/** The job was cancelled while it waited on a fetch; nothing is reported for it. */
export class ModelCancelled extends Error {}

/** A component the field needs is not in this run at this step. Retrying will not help until the run changes. */
export class ModelMissing extends Error {}
