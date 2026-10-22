'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

interface CertificateQRCodeProps {
  certId: string;
  /** Optional human-readable summary shown alongside the QR code when printing. */
  summary?: {
    title?: string;
    holder?: string;
    issuedAt?: string;
  };
}

/**
 * Renders a QR code that links to the public verifier for a certificate
 * (`/verify?id=<cert_id>`), with PNG/SVG download and print-optimized styling.
 */
export default function CertificateQRCode({ certId, summary }: CertificateQRCodeProps) {
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const verifyUrl = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/verify?id=${encodeURIComponent(certId)}`;
  }, [certId]);

  useEffect(() => {
    let cancelled = false;

    async function generate() {
      try {
        const QRCode = (await import('qrcode')).default;
        const svg = await QRCode.toString(verifyUrl, {
          type: 'svg',
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 256,
        });
        if (!cancelled) {
          setSvgMarkup(svg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError('Unable to generate QR code.');
        }
      }
    }

    generate();
    return () => {
      cancelled = true;
    };
  }, [verifyUrl]);

  function downloadSvg() {
    if (!svgMarkup) return;
    const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    triggerDownload(URL.createObjectURL(blob), `certificate-${certId}.svg`);
  }

  async function downloadPng() {
    if (!svgMarkup) return;
    try {
      const img = new Image();
      const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load QR image'));
        img.src = url;
      });

      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not supported');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);

      canvas.toBlob((blob) => {
        if (blob) {
          triggerDownload(URL.createObjectURL(blob), `certificate-${certId}.png`);
        }
      }, 'image/png');
    } catch (err) {
      setError('Unable to download PNG.');
    }
  }

  function triggerDownload(href: string, filename: string) {
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  return (
    <div className="certificate-qr" ref={containerRef}>
      <style>{`
        .certificate-qr {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          padding: 1rem;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          background: #ffffff;
          max-width: 320px;
        }
        .certificate-qr__code {
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 256px;
        }
        .certificate-qr__code svg {
          width: 256px;
          height: 256px;
        }
        .certificate-qr__summary {
          font-size: 0.875rem;
          line-height: 1.4;
          color: #111827;
        }
        .certificate-qr__summary dt {
          font-weight: 600;
        }
        .certificate-qr__summary dd {
          margin: 0 0 0.25rem 0;
        }
        .certificate-qr__url {
          font-size: 0.75rem;
          word-break: break-all;
          color: #4b5563;
        }
        .certificate-qr__actions {
          display: flex;
          gap: 0.5rem;
        }
        .certificate-qr__actions button {
          flex: 1;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          border-radius: 0.375rem;
          border: 1px solid #d1d5db;
          background: #f9fafb;
          cursor: pointer;
        }
        .certificate-qr__actions button:hover {
          background: #f3f4f6;
        }
        .certificate-qr__error {
          color: #b91c1c;
          font-size: 0.875rem;
        }
        @media print {
          .certificate-qr {
            border: 1px solid #000000;
            box-shadow: none;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .certificate-qr__actions {
            display: none;
          }
          .certificate-qr__code svg {
            width: 200px;
            height: 200px;
          }
          .certificate-qr__summary,
          .certificate-qr__url {
            color: #000000;
          }
        }
      `}</style>

      <div className="certificate-qr__code">
        {svgMarkup ? (
          <div dangerouslySetInnerHTML={{ __html: svgMarkup }} />
        ) : (
          <span className="certificate-qr__error">{error ?? 'Generating QR code…'}</span>
        )}
      </div>

      {summary && (
        <dl className="certificate-qr__summary">
          {summary.title && (
            <>
              <dt>Certificate</dt>
              <dd>{summary.title}</dd>
            </>
          )}
          {summary.holder && (
            <>
              <dt>Holder</dt>
              <dd>{summary.holder}</dd>
            </>
          )}
          {summary.issuedAt && (
            <>
              <dt>Issued</dt>
              <dd>{summary.issuedAt}</dd>
            </>
          )}
        </dl>
      )}

      <div className="certificate-qr__url">{verifyUrl}</div>

      <div className="certificate-qr__actions">
        <button type="button" onClick={downloadPng} disabled={!svgMarkup}>
          Download PNG
        </button>
        <button type="button" onClick={downloadSvg} disabled={!svgMarkup}>
          Download SVG
        </button>
      </div>
    </div>
  );
}
