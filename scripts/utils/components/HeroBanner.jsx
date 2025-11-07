export default function HeroBanner({ client }) {
  const hero = client?.brand?.hero;
  return (
    <div
      className="hero"
      style={hero ? { backgroundImage: `url(${hero})` } : undefined}
      aria-hidden="true"
    />
  );
}