export default function CalendarPanel() {
  const today = new Date(),
    start = new Date(today);
  start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return (
    <div className="panel-body">
      <div className="calendar-date">
        <span className="date-big">{today.getDate()}</span>
        <div className="date-meta">
          <strong>{today.toLocaleDateString('pt-BR', { weekday: 'long' })}</strong>
          {today.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
        </div>
      </div>
      <div className="week">
        {Array.from({ length: 7 }, (_, i) => {
          const date = new Date(start);
          date.setDate(start.getDate() + i);
          return (
            <div key={i} className={'day ' + (date.toDateString() === today.toDateString() ? 'active' : '')}>
              <span>{['S', 'T', 'Q', 'Q', 'S', 'S', 'D'][i]}</span>
              <strong>{date.getDate()}</strong>
            </div>
          );
        })}
      </div>
      <div className="event">
        <time>09:00</time>
        <div>
          <strong>Planejar a semana</strong>
          <small>Exemplo · 30 min</small>
        </div>
      </div>
      <p className="resource-note">
        Agenda demonstrativa. A conexão com calendário ainda não está disponível.
      </p>
    </div>
  );
}
