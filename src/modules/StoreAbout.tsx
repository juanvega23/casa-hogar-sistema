// "Quiénes somos" de la tienda: misión, visión, valores y ubicación.

const MISION =
  'Comercializar productos ferreteros para la construcción, reparación y mantenimiento, ofreciendo soluciones acordes con las necesidades de nuestros clientes, mediante una atención responsable, productos de calidad y una gestión eficiente de nuestras operaciones.'

const VISION =
  'Consolidarnos como una ferretería competitiva y reconocida por la confianza de nuestros clientes, la calidad del servicio y la variedad de productos, fortaleciendo nuestra presencia comercial mediante la innovación, la modernización de los procesos y el crecimiento sostenible de la empresa.'

const VALORES = [
  { nombre: 'Responsabilidad', descripcion: 'Cumplir oportunamente los compromisos asumidos con clientes, proveedores y colaboradores.' },
  { nombre: 'Honestidad', descripcion: 'Actuar con integridad y transparencia en las relaciones comerciales y administrativas.' },
  { nombre: 'Compromiso', descripcion: 'Desempeñar las funciones con dedicación, disciplina y orientación al cumplimiento de los objetivos.' },
  { nombre: 'Calidad del servicio', descripcion: 'Ofrecer atención respetuosa, orientación adecuada y soluciones oportunas a los clientes.' },
  { nombre: 'Trabajo en equipo', descripcion: 'Fomentar la colaboración, comunicación y coordinación entre las distintas funciones de la empresa.' },
  { nombre: 'Innovación', descripcion: 'Promover la incorporación de nuevas prácticas y tecnologías que contribuyan al desarrollo comercial y organizacional.' },
  { nombre: 'Mejora continua', descripcion: 'Evaluar y perfeccionar los procedimientos para fortalecer la eficiencia y calidad de las operaciones.' },
]

type StoreAboutProps = {
  direccion: string
  mapa: string
  telefono: string
  telefonoEnlace: string
  whatsappEnlace: string
  onVerProductos: () => void
}

export function StoreAbout({ direccion, mapa, telefono, telefonoEnlace, whatsappEnlace, onVerProductos }: StoreAboutProps) {
  return (
    <main className="t-contenido t-nosotros">
      <section className="t-nosotros-portada">
        <h1>Ferretería Casa Hogar</h1>
        <p>
          Somos una ferretería ubicada en Managua. Ofrecemos herramientas, materiales de construcción y todo lo que
          necesitás para tu casa o tu obra.
        </p>
      </section>

      <section className="t-nosotros-ubicacion" aria-labelledby="t-titulo-ubicacion">
        <div>
          <h2 id="t-titulo-ubicacion">Contacto y ubicación</h2>
          <p>{direccion}</p>
          <div className="t-nosotros-enlaces">
            <a href={mapa} target="_blank" rel="noopener noreferrer">Cómo llegar</a>
            <a href={telefonoEnlace}>Llamar al {telefono}</a>
            <a href={whatsappEnlace} target="_blank" rel="noopener noreferrer">WhatsApp {telefono}</a>
          </div>
        </div>
        <button type="button" className="t-boton t-boton--primario" onClick={onVerProductos}>
          Ver productos
        </button>
      </section>

      <div className="t-nosotros-par">
        <section className="t-nosotros-tarjeta">
          <h2>Misión</h2>
          <p>{MISION}</p>
        </section>
        <section className="t-nosotros-tarjeta">
          <h2>Visión</h2>
          <p>{VISION}</p>
        </section>
      </div>

      <section className="t-bloque" aria-labelledby="t-titulo-valores">
        <div className="t-bloque-cabeza">
          <div>
            <h2 id="t-titulo-valores">Nuestros valores</h2>
            <p>Lo que guía cómo atendemos y cómo trabajamos.</p>
          </div>
        </div>
        <ul className="t-valores">
          {VALORES.map(valor => (
            <li key={valor.nombre}>
              <strong>{valor.nombre}</strong>
              <span>{valor.descripcion}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
