export default function ProductCard({ product }) {
  const { name, price, link, image } = product;
  return (
    <div className="card">
      <div className="card-media">
        {image ? <img src={image} alt={name} /> : null}
      </div>
      <div className="card-body">
        <div className="card-title">{name}</div>
        <div className="price">${Number(price).toFixed(2)}</div>
        {link ? (
          <a className="buy" href={link} target="_blank" rel="noreferrer">Buy</a>
        ) : (
          <button className="buy" disabled>Unavailable</button>
        )}
      </div>
    </div>
  );
}