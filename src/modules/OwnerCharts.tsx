import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'

import { dinero } from '../lib/negocioPropietario'

/*
 * Gráficos de las pantallas del Propietario. Todo valor se puede leer
 * también sin pasar el mouse: en la leyenda o en "Ver los datos".
 */

// ---------------------------------------------------------
// Líneas: una sola escala, con cruz que sigue al cursor
// ---------------------------------------------------------

type Serie = { nombre: string, color: string, valores: (number | null)[] }

const MARGEN = { arriba: 22, derecha: 18, abajo: 28, izquierda: 62 }
const ALTO = 260

function escala(maximo: number) {
  if (maximo <= 0) return { tope: 100, paso: 25 }

  const potencia = 10 ** Math.floor(Math.log10(maximo))
  const fraccion = maximo / potencia

  if (fraccion <= 1) return { tope: potencia, paso: potencia / 4 }
  if (fraccion <= 2) return { tope: 2 * potencia, paso: potencia / 2 }
  if (fraccion <= 5) return { tope: 5 * potencia, paso: potencia }

  return { tope: 10 * potencia, paso: 2 * potencia }
}

function textoEje(valor: number) {
  if (valor >= 1000000) return `C$${valor / 1000000}M`

  return valor >= 10000
    ? `C$${Math.round(valor / 1000)}K`
    : `C$${new Intl.NumberFormat('es-NI').format(valor)}`
}

export function GraficoLineas({
  titulo,
  etiquetas,
  marcas,
  series,
}: {
  titulo: string
  etiquetas: string[]
  marcas: number[]
  series: Serie[]
}) {
  const caja = useRef<HTMLDivElement>(null)
  const [ancho, setAncho] = useState(0)
  const [activo, setActivo] = useState<number | null>(null)

  useEffect(() => {
    const elemento = caja.current

    if (!elemento) return

    const observador = new ResizeObserver(([entrada]) => setAncho(entrada.contentRect.width))

    observador.observe(elemento)

    return () => observador.disconnect()
  }, [])

  const plano = Math.max(ancho - MARGEN.izquierda - MARGEN.derecha, 1)
  const altoPlano = ALTO - MARGEN.arriba - MARGEN.abajo
  const todos = series.flatMap(serie => serie.valores).filter((v): v is number => v !== null)
  const { tope, paso } = escala(Math.max(...todos, 0))
  const piso = Math.min(...todos, 0)
  const ultimo = etiquetas.length - 1

  const x = (indice: number) => MARGEN.izquierda + (ultimo > 0 ? (indice / ultimo) * plano : plano / 2)
  const y = (valor: number) => MARGEN.arriba + altoPlano - ((valor - piso) / (tope - piso)) * altoPlano

  const lineas: number[] = []
  for (let valor = 0; valor <= tope + paso / 2; valor += paso) lineas.push(valor)

  // En pantallas angostas se saltan etiquetas para que no se pisen,
  // de derecha a izquierda para conservar siempre la última.
  const marcasVisibles = [...marcas].reverse().reduce<number[]>((elegidas, indice) => {
    const anterior = elegidas[elegidas.length - 1]

    return anterior === undefined || x(anterior) - x(indice) >= 52 ? [...elegidas, indice] : elegidas
  }, [])

  function trazo(valores: (number | null)[]) {
    return valores.reduce<string>((camino, valor, indice) => {
      if (valor === null) return camino

      return `${camino}${camino ? 'L' : 'M'}${x(indice).toFixed(1)} ${y(valor).toFixed(1)}`
    }, '')
  }

  function mover(event: PointerEvent<SVGSVGElement>) {
    const marco = event.currentTarget.getBoundingClientRect()
    const relativo = (event.clientX - marco.left - MARGEN.izquierda) / plano

    setActivo(Math.min(ultimo, Math.max(0, Math.round(relativo * ultimo))))
  }

  function teclado(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

    event.preventDefault()
    setActivo(actual => {
      const base = actual ?? ultimo

      return Math.min(ultimo, Math.max(0, base + (event.key === 'ArrowRight' ? 1 : -1)))
    })
  }

  const principal = series[0]
  const finPrincipal = principal.valores.reduce<number | null>((fin, valor, indice) => (valor === null ? fin : indice), null)
  const izquierdaAyuda = activo === null ? 0 : Math.min(Math.max(x(activo) - 110, 0), Math.max(ancho - 240, 0))

  return (
    <div className="grafico">
      {series.length > 1 && (
        <ul className="grafico-leyenda">
          {series.map(serie => (
            <li key={serie.nombre}>
              <span className="grafico-clave-linea" style={{ background: serie.color }} />
              {serie.nombre}
            </li>
          ))}
        </ul>
      )}

      <div className="grafico-lienzo" ref={caja}>
        {ancho > 0 && (
          <svg
            width={ancho}
            height={ALTO}
            role="img"
            aria-label={titulo}
            tabIndex={0}
            onPointerMove={mover}
            onPointerLeave={() => setActivo(null)}
            onFocus={() => setActivo(actual => actual ?? ultimo)}
            onBlur={() => setActivo(null)}
            onKeyDown={teclado}
          >
            {lineas.map(valor => (
              <g key={valor}>
                <line x1={MARGEN.izquierda} x2={ancho - MARGEN.derecha} y1={y(valor)} y2={y(valor)} className="grafico-rejilla" />
                <text x={MARGEN.izquierda - 8} y={y(valor) + 4} textAnchor="end" className="grafico-eje">{textoEje(valor)}</text>
              </g>
            ))}

            {marcasVisibles.map(indice => (
              <text key={indice} x={x(indice)} y={ALTO - 8} textAnchor={indice === 0 ? 'start' : indice === ultimo ? 'end' : 'middle'} className="grafico-eje">
                {etiquetas[indice]}
              </text>
            ))}

            {[...series].reverse().map(serie => (
              <path key={serie.nombre} d={trazo(serie.valores)} fill="none" stroke={serie.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            ))}

            {finPrincipal !== null && (
              <>
                <circle cx={x(finPrincipal)} cy={y(principal.valores[finPrincipal] ?? 0)} r={5} fill={principal.color} stroke="#fff" strokeWidth={2} />
                <text
                  x={x(finPrincipal) + (finPrincipal > ultimo / 2 ? -10 : 10)}
                  y={y(principal.valores[finPrincipal] ?? 0) - 10}
                  textAnchor={finPrincipal > ultimo / 2 ? 'end' : 'start'}
                  className="grafico-valor"
                >
                  {dinero(principal.valores[finPrincipal] ?? 0)}
                </text>
              </>
            )}

            {activo !== null && (
              <>
                <line x1={x(activo)} x2={x(activo)} y1={MARGEN.arriba} y2={MARGEN.arriba + altoPlano} className="grafico-cruz" />
                {series.map(serie => {
                  const valor = serie.valores[activo]

                  return valor === null ? null : (
                    <circle key={serie.nombre} cx={x(activo)} cy={y(valor)} r={4} fill={serie.color} stroke="#fff" strokeWidth={2} />
                  )
                })}
              </>
            )}
          </svg>
        )}

        {activo !== null && (
          <div className="grafico-ayuda" style={{ left: izquierdaAyuda }}>
            <small>{etiquetas[activo]}</small>
            {series.map(serie => {
              const valor = serie.valores[activo]

              return valor === null ? null : (
                <div key={serie.nombre}>
                  <span className="grafico-clave-linea" style={{ background: serie.color }} />
                  <strong>{dinero(valor)}</strong> {serie.nombre}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}


// ---------------------------------------------------------
// Barra partida: un total y de qué está hecho
// ---------------------------------------------------------

export type Parte = { nombre: string, valor: number, color: string, tinta: string }

export function BarraPartida({ partes, etiqueta }: { partes: Parte[], etiqueta: string }) {
  const visibles = partes.filter(parte => parte.valor > 0)
  const total = visibles.reduce((suma, parte) => suma + parte.valor, 0)

  if (total <= 0) return null

  return (
    <div className="barra-partida">
      <div
        className="barra-partida-bloques"
        role="img"
        aria-label={`${etiqueta}: ${visibles.map(p => `${p.nombre} ${dinero(p.valor)}`).join(', ')}`}
      >
        {visibles.map(parte => {
          const parteTotal = Math.round((parte.valor / total) * 100)

          return (
            <div
              key={parte.nombre}
              className="barra-partida-bloque"
              style={{ flexGrow: parte.valor, background: parte.color, color: parte.tinta }}
              title={`${parte.nombre}: ${dinero(parte.valor)} (${parteTotal} %)`}
            >
              {parteTotal >= 14 ? `${parteTotal} %` : ''}
            </div>
          )
        })}
      </div>

      <ul className="barra-partida-leyenda">
        {visibles.map(parte => (
          <li key={parte.nombre}>
            <span className="grafico-clave-bloque" style={{ background: parte.color }} />
            <span>{parte.nombre}</span>
            <strong>{dinero(parte.valor)}</strong>
          </li>
        ))}
      </ul>
    </div>
  )
}


// ---------------------------------------------------------
// Barras ordenadas de mayor a menor
// ---------------------------------------------------------

export function BarrasRanking({
  filas,
  color,
}: {
  filas: { nombre: string, valor: number, nota: string }[]
  color: string
}) {
  const maximo = Math.max(...filas.map(fila => fila.valor), 1)

  return (
    <ul className="ranking">
      {filas.map(fila => (
        <li key={fila.nombre}>
          <span className="ranking-nombre">{fila.nombre}</span>
          <div className="ranking-pista">
            <div
              className="ranking-barra"
              style={{ width: `${Math.max((Math.max(fila.valor, 0) / maximo) * 100, fila.valor > 0 ? 2 : 0)}%`, background: color }}
            />
          </div>
          <span className="ranking-valor">
            <strong>{dinero(fila.valor)}</strong>
            <small>{fila.nota}</small>
          </span>
        </li>
      ))}
    </ul>
  )
}


// ---------------------------------------------------------
// Mapa de calor: un solo azul, de claro a oscuro
// ---------------------------------------------------------

function mezclar(fraccion: number) {
  const desde = [227, 232, 250]
  const hasta = [47, 59, 156]

  return `rgb(${desde.map((canal, i) => Math.round(canal + (hasta[i] - canal) * fraccion)).join(', ')})`
}

export type Celda = { fila: number, columna: number, valor: number, detalle: string }

export function MapaCalor({
  filas,
  columnas,
  celdas,
  ayuda,
}: {
  filas: string[]
  columnas: string[]
  celdas: Celda[]
  ayuda: string
}) {
  const [leyendo, setLeyendo] = useState<string | null>(null)
  const maximo = Math.max(...celdas.map(celda => celda.valor), 0)

  return (
    <div className="calor">
      <div className="calor-rejilla" style={{ gridTemplateColumns: `72px repeat(${columnas.length}, minmax(0, 1fr))` }}>
        <span />
        {columnas.map(columna => <span key={columna} className="calor-titulo">{columna}</span>)}

        {filas.map((fila, indiceFila) => (
          <FilaCalor key={fila} titulo={fila}>
            {columnas.map((columna, indiceColumna) => {
              const celda = celdas.find(c => c.fila === indiceFila && c.columna === indiceColumna)
              const valor = celda?.valor ?? 0
              const texto = celda?.detalle ?? `${columna} ${fila.toLowerCase()}: sin ventas`

              return (
                <button
                  key={columna}
                  type="button"
                  className="calor-celda"
                  style={{ background: valor > 0 ? mezclar(valor / maximo) : '#f3f5f8' }}
                  aria-label={texto}
                  title={texto}
                  onPointerEnter={() => setLeyendo(texto)}
                  onPointerLeave={() => setLeyendo(null)}
                  onFocus={() => setLeyendo(texto)}
                  onBlur={() => setLeyendo(null)}
                />
              )
            })}
          </FilaCalor>
        ))}
      </div>

      <div className="calor-pie">
        <span className="calor-lectura">{leyendo ?? ayuda}</span>
        <span className="calor-escala">
          Menos
          <span className="calor-degradado" />
          Más
        </span>
      </div>
    </div>
  )
}

function FilaCalor({ titulo, children }: { titulo: string, children: ReactNode }) {
  return (
    <>
      <span className="calor-titulo calor-titulo--fila">{titulo}</span>
      {children}
    </>
  )
}


// ---------------------------------------------------------
// Los mismos datos en tabla, para quien prefiera los números
// ---------------------------------------------------------

export function VerDatos({ columnas, filas }: { columnas: string[], filas: string[][] }) {
  return (
    <details className="ver-datos">
      <summary>Ver los datos</summary>
      <div className="history-table-wrap">
        <table className="history-table">
          <thead>
            <tr>{columnas.map(columna => <th key={columna}>{columna}</th>)}</tr>
          </thead>
          <tbody>
            {filas.map((fila, indice) => (
              <tr key={indice}>
                {fila.map((valor, posicion) => <td key={posicion}>{valor}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
