import './shell.css';

/** Drifting aurora blobs + dot grid + grain. Pure CSS animation; sits behind everything. */
export function Aurora({ intensity = 1 }: { intensity?: number }) {
  return (
    <div className="aurora" style={{ opacity: intensity }} aria-hidden>
      <div className="aurora-blob b1" />
      <div className="aurora-blob b2" />
      <div className="aurora-blob b3" />
      <div className="aurora-blob b4" />
      <div className="aurora-dots dots" />
      <div className="aurora-grain" />
    </div>
  );
}
