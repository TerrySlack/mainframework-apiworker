"use client";
import { useRef } from "react";
import { isEqual } from "@mainframework/is-deep-equal";

export const useCustomCallback = <T extends (...args: any[]) => any>(callback: T, dependencies: unknown[]): T => {
  const refCallback = useRef<T>(callback);
  const refDependencies = useRef<unknown[]>(dependencies);

  // Update refs synchronously during render
  if (!dependencies.every((dep, index) => isEqual(dep, refDependencies.current[index]))) {
    refDependencies.current = dependencies;
    refCallback.current = callback;
  }

  // Stable callback, always calls latest callback
  const stableCallback = useRef((...args: Parameters<T>): ReturnType<T> => refCallback.current(...args)).current;

  return stableCallback as T;
};
