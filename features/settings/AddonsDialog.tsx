export default function AddonsDialog() {
  return (
    <>
      {[
        ['Calendário', 'Demonstrativo'],
        ['Trello', 'Em breve'],
        ['Meu computador', 'Local'],
      ].map(([name, text]) => (
        <div className="addon-card" key={name}>
          <div className="addon-info">
            <strong>{name}</strong>
            <p>{text}</p>
          </div>
        </div>
      ))}
    </>
  );
}
