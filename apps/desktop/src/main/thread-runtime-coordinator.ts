import type { CoreKind } from "@eco/runtime";

export interface ThreadRuntimeAdapter<
  TStart,
  TContinue,
  TCancel,
  TStartResult,
  TContinueResult,
  TCancelResult,
> {
  readonly kind: CoreKind;
  start(input: TStart): Promise<TStartResult> | TStartResult;
  continue(input: TContinue): Promise<TContinueResult> | TContinueResult;
  cancel(input: TCancel): Promise<TCancelResult> | TCancelResult;
}

export class ThreadRuntimeCoordinator<
  TStart,
  TContinue,
  TCancel,
  TStartResult = void,
  TContinueResult = void,
  TCancelResult = void,
> {
  private readonly adapters = new Map<
    CoreKind,
    ThreadRuntimeAdapter<TStart, TContinue, TCancel, TStartResult, TContinueResult, TCancelResult>
  >();

  register(
    adapter: ThreadRuntimeAdapter<TStart, TContinue, TCancel, TStartResult, TContinueResult, TCancelResult>,
  ): void {
    if (this.adapters.has(adapter.kind)) {
      throw new Error(`Thread runtime adapter is already registered: ${adapter.kind}`);
    }
    this.adapters.set(adapter.kind, adapter);
  }

  start(kind: CoreKind, input: TStart): Promise<TStartResult> {
    return Promise.resolve(this.require(kind).start(input));
  }

  continue(kind: CoreKind, input: TContinue): Promise<TContinueResult> {
    return Promise.resolve(this.require(kind).continue(input));
  }

  cancel(kind: CoreKind, input: TCancel): Promise<TCancelResult> {
    return Promise.resolve(this.require(kind).cancel(input));
  }

  private require(
    kind: CoreKind,
  ): ThreadRuntimeAdapter<TStart, TContinue, TCancel, TStartResult, TContinueResult, TCancelResult> {
    const adapter = this.adapters.get(kind);
    if (!adapter) {
      throw new Error(`Thread runtime adapter is not registered: ${kind}`);
    }
    return adapter;
  }
}
