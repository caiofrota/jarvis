export default function AddonsDialog() {
  return (
    <>
      {[
        ['Calendário', 'A agenda ainda mostra exemplos. A conexão com sua conta será uma próxima etapa.'],
        ['Trello', 'Integração planejada. Nenhum quadro ou conta está conectado.'],
        ['Meu computador', 'Abertura direta de aplicativos e pastas disponíveis neste PC.'],
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
