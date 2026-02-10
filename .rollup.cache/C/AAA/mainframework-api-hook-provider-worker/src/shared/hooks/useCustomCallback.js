"use client";
import { useRef } from "react";
import { isEqual } from "@mainframework/is-deep-equal";
export const useCustomCallback = (callback, dependencies) => {
  const refCallback = useRef(callback);
  const refDependencies = useRef(dependencies);
  // Update refs synchronously during render
  if (!dependencies.every((dep, index) => isEqual(dep, refDependencies.current[index]))) {
    refDependencies.current = dependencies;
    refCallback.current = callback;
  }
  // Stable callback, always calls latest callback
  const stableCallback = useRef((...args) => refCallback.current(...args)).current;
  return stableCallback;
};
//# sourceMappingURL=useCustomCallback.js.map
