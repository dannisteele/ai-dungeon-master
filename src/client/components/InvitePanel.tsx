import qrcode from "qrcode-generator";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { inviteLinks } from "../lib/invite";

/** A scannable QR code for a link, drawn as SVG so it stays sharp at any size. */
function QrCode({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4},${r + 4}h1v1h-1z`;
    return { size: n + 8, path: d }; // 4 modules of quiet zone each side, as scanners expect
  }, [text]);
  return (
    <svg className="invite-qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`QR code for ${text}`} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

/** Copies text. The clipboard API only exists on https or localhost, so phones on http://192.168… fall back to execCommand. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  area.remove();
  return ok;
}

/** Tells the host what address to send other players, since "localhost" only works on this computer. */
export function InvitePanel({ onClose }: { onClose: () => void }) {
  const [links, setLinks] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    api.invite().then((r) => setLinks(inviteLinks(r.addresses, location)), (e: Error) => setError(e.message));
  }, []);

  async function copy(link: string) {
    setCopied((await copyText(link)) ? link : null);
  }

  const [best, ...others] = links ?? [];

  return (
    <div className="recap-backdrop" onClick={onClose}>
      <section className="recap-panel" role="dialog" aria-modal="true" aria-labelledby="invite-title" onClick={(e) => e.stopPropagation()}>
        <header className="row spread">
          <h2 id="invite-title" style={{ margin: 0 }}>Invite someone</h2>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </header>
        <div className="stack recap-body">
          {links === null && !error && <p className="muted" style={{ margin: 0 }}>Finding this computer's address…</p>}
          {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
          {links !== null && !best && (
            <p style={{ margin: 0 }}>
              This computer doesn't seem to be on a Wi-Fi or wired network right now, so nobody else can join. Connect it to your
              Wi-Fi, then open this again.
            </p>
          )}
          {best && (
            <>
              <p style={{ margin: 0 }}>Send this link to the other players, or let them scan the code with their phone camera:</p>
              <div className="row invite-link">
                <input className="input" readOnly value={best} aria-label="Link for other players" onFocus={(e) => e.target.select()} />
                <button className="btn btn-primary" onClick={() => void copy(best)}>{copied === best ? "Copied!" : "Copy"}</button>
              </div>
              <QrCode text={best} />
              <ul className="small" style={{ margin: 0 }}>
                <li><b>They need to be on the same Wi-Fi as this computer.</b> It won't work over mobile data or from a guest Wi-Fi network.</li>
                <li>They'll be asked for the <b>table password</b>, so tell them that too.</li>
                <li>This computer has to stay on, with the game running, while you play.</li>
                <li>The address can change when the computer reconnects to the Wi-Fi. If an old link stops working, open this again.</li>
              </ul>
              {others.length > 0 && (
                <div className="stack">
                  <button className="link-btn" style={{ alignSelf: "flex-start" }} aria-expanded={showOthers} onClick={() => setShowOthers((s) => !s)}>
                    {showOthers ? "Hide other addresses" : "Link not working? Try another address"}
                  </button>
                  {showOthers && others.map((link) => (
                    <div key={link} className="row invite-link">
                      <input className="input" readOnly value={link} aria-label="Another link to try" onFocus={(e) => e.target.select()} />
                      <button className="btn btn-ghost" onClick={() => void copy(link)}>{copied === link ? "Copied!" : "Copy"}</button>
                    </div>
                  ))}
                </div>
              )}
              <p className="muted small" style={{ margin: 0 }}>
                Still can't connect? Check the other device really is on the same Wi-Fi. On a work computer, security software may block
                other devices from reaching it.
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
