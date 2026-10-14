import initialize from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { setOC } from 'replicad';
let ready: ReturnType<typeof initialize> | undefined;
export function getCadKernel() {
  return (ready ??= initialize({ locateFile: () => wasmUrl, print: () => {}, printErr: () => {} }).then(
    (oc) => {
      setOC(oc);
      return oc;
    },
  ));
}
