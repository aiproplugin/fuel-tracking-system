"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";

/**
 * M3_QRScanner — html5-qrcode camera view with a manual-token fallback.
 * The camera needs HTTPS (or localhost); when it can't start, manual entry
 * is the supported path until Phase 7 puts the app behind HTTPS.
 */
export interface QrScannerProps {
  onToken: (token: string, manual: boolean) => void;
  disabled: boolean;
  errorMessage: string | null;
}

const READER_ELEMENT_ID = "fuel-qr-reader";

export function QrScanner({ onToken, disabled, errorMessage }: QrScannerProps) {
  const [cameraError, setCameraError] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const scannedRef = useRef(false);

  useEffect(() => {
    // Guard double-invocation (React strict mode) and unmount races.
    let disposed = false;
    let scanner: { stop: () => Promise<void>; clear: () => void } | null = null;
    // html5-qrcode's stop() throws SYNCHRONOUSLY if the camera never ran;
    // an escaped throw in React's cleanup phase unmounts the whole tree
    // (silent flow reset). Only stop a camera that actually started, and
    // still guard the call defensively.
    let cameraStarted = false;

    function safeStop(target: { stop: () => Promise<void>; clear: () => void }) {
      try {
        target
          .stop()
          .then(() => target.clear())
          .catch(() => undefined);
      } catch {
        // Synchronous "Cannot stop, scanner is not running" — nothing to do.
      }
    }

    async function startCamera() {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (disposed) return;
        const instance = new Html5Qrcode(READER_ELEMENT_ID);
        scanner = instance;
        await instance.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText) => {
            if (!scannedRef.current) {
              scannedRef.current = true;
              onToken(decodedText.trim(), false);
            }
          },
          () => {
            // Per-frame decode misses are normal; stay silent.
          },
        );
        cameraStarted = true;
        if (disposed) {
          // Unmounted while the camera was still warming up.
          safeStop(instance);
        }
      } catch {
        if (!disposed) setCameraError(true);
      }
    }

    void startCamera();
    return () => {
      disposed = true;
      if (scanner && cameraStarted) {
        safeStop(scanner);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start camera once
  }, []);

  // Allow re-scanning after a failed lookup.
  useEffect(() => {
    if (errorMessage) {
      scannedRef.current = false;
    }
  }, [errorMessage]);

  function handleManualSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = manualToken.trim();
    if (token.length >= 4) {
      onToken(token, true);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mt-8 text-center">
        <h1 className="text-2xl font-bold">Scan vehicle QR</h1>
        <p className="mt-2 text-slate-400">Hold the code inside the frame</p>
      </div>

      <div className="mx-auto mt-8 w-full max-w-[280px]">
        {cameraError ? (
          <div className="flex h-[280px] items-center justify-center rounded-[32px] border-2 border-white/40 p-6 text-center text-sm text-slate-300">
            Camera unavailable (needs HTTPS or localhost). Use manual token entry below.
          </div>
        ) : (
          <div
            id={READER_ELEMENT_ID}
            className="overflow-hidden rounded-[32px] border-2 border-white/80"
          />
        )}
      </div>

      {errorMessage ? (
        <p role="alert" className="mt-4 text-center text-sm font-medium text-red-400">
          {errorMessage}
        </p>
      ) : null}

      <div className="mt-auto rounded-[24px] border border-white/10 bg-white/10 p-4 backdrop-blur">
        <p className="text-sm font-semibold">Manual token entry</p>
        <p className="mt-1 text-xs text-slate-400">
          Type the code printed under the QR (rate-limited).
        </p>
        <form onSubmit={handleManualSubmit} className="mt-3 flex gap-2">
          <Input
            value={manualToken}
            onChange={(event) => setManualToken(event.target.value)}
            placeholder="FT-…"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="border-white/20 bg-white/10 text-white placeholder:text-slate-400"
            aria-label="QR token"
          />
          <button
            type="submit"
            disabled={disabled || manualToken.trim().length < 4}
            className="rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            Find
          </button>
        </form>
      </div>
    </div>
  );
}
