/** Multi-layer warm background with subtle noise + accent glow. */
export function BackgroundLayer() {
  return (
    <>
      <div
        className="fixed inset-0 -z-30"
        style={{
          background:
            "radial-gradient(120% 90% at 12% 8%, #D9CDB8 0%, #E5D8C0 32%, #EDE3D2 60%, #F0E7D6 100%)",
        }}
      />
      {/* Soft blue accent */}
      <div
        className="fixed inset-0 -z-20 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 40% at 70% 16%, rgba(123,168,217,0.18) 0%, rgba(123,168,217,0) 60%)",
        }}
      />
      {/* Soft green accent (bottom-right) */}
      <div
        className="fixed inset-0 -z-20 pointer-events-none"
        style={{
          background:
            "radial-gradient(40% 30% at 92% 88%, rgba(31,184,92,0.13) 0%, rgba(31,184,92,0) 60%)",
        }}
      />
      {/* Grain dots */}
      <div className="grain" />
    </>
  );
}
