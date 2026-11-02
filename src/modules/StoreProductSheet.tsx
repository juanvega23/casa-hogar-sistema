import type { DetalleProducto } from '../lib/fichasTienda'

// Ficha del producto en la ventana de detalle de la tienda.

export function FichaProducto({ detalle }: { detalle: DetalleProducto | undefined }) {
  if (
    !detalle ||
    (!detalle.caracteristicas.length && !detalle.dimensiones.length && !detalle.modoUso && !detalle.areas.length)
  ) {
    return null
  }

  return (
    <div className="t-ficha">
      {detalle.caracteristicas.length > 0 && (
        <section>
          <h3>Características</h3>
          <ul className="t-ficha-lista">
            {detalle.caracteristicas.map(linea => <li key={linea}>{linea}</li>)}
          </ul>
        </section>
      )}

      {detalle.dimensiones.length > 0 && (
        <section>
          <h3>Medidas</h3>
          <dl className="t-ficha-medidas">
            {detalle.dimensiones.map(({ etiqueta, valor }) => (
              <div key={etiqueta + valor}>
                {etiqueta && <dt>{etiqueta}</dt>}
                <dd>{valor}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {detalle.modoUso && (
        <section>
          <h3>Modo de uso</h3>
          <p>{detalle.modoUso}</p>
        </section>
      )}

      {detalle.areas.length > 0 && (
        <section className="t-ficha-areas-seccion">
          <h3>Áreas de aplicación</h3>
          <div className="t-ficha-areas">
            {detalle.areas.map(area => <span key={area}>{area}</span>)}
          </div>
        </section>
      )}
    </div>
  )
}
