import {
  useEffect,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'
import {
  clasificarProductos,
  COLORES,
  conMayuscula,
  DIAS_LARGOS,
  DIAS_SEMANA,
  dinero,
  duracionInventario,
  FRANJAS,
  margen,
  nombreMes,
  porcentaje,
  productosDelOchenta,
  textoDuracion,
  type Analisis,
} from '../lib/negocioPropietario'
import {
  BarraPartida,
  BarrasRanking,
  GraficoLineas,
  MapaCalor,
  VerDatos,
} from './OwnerCharts'

/*
 * Reportes y análisis del Propietario: cada tarjeta responde una
 * pregunta de dueño. No es el reporte operativo de Gerencia
 * (OwnerReportsModule). Datos: analisis_propietario(meses).
 */

const PERIODOS = [3, 6, 12]
const MAX_DEPARTAMENTOS = 8
const MAX_POR_GRUPO = 4

export default function OwnerAnalysisModule() {
  const [meses, setMeses] = useState(6)
  const [datos, setDatos] = useState<Analisis | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let vigente = true

    void supabase.rpc('analisis_propietario', { p_meses: meses }).then(({ data, error: rpcError }) => {
      if (!vigente) return

      setCargando(false)
      setError(rpcError ? rpcError.message : '')

      if (!rpcError) setDatos(data as Analisis)
    })

    return () => {
      vigente = false
    }
  }, [meses])

  if (!datos) {
    return cargando ? (
      <div className="owner-dashboard-loading">
        <div className="inventory-spinner" />
        <span>Analizando tu negocio...</span>
      </div>
    ) : (
      <div className="inventory-error">{error || 'No fue posible cargar el análisis.'}</div>
    )
  }

  return (
    <div className="panorama">
      <section className="panorama-periodo">
        <span>Ver los últimos</span>
        <div role="group" aria-label="Período del análisis">
          {PERIODOS.map(periodo => (
            <button
              key={periodo}
              type="button"
              aria-pressed={meses === periodo}
              className={meses === periodo ? 'panorama-periodo-boton panorama-periodo-boton--activo' : 'panorama-periodo-boton'}
              onClick={() => {
                if (meses === periodo) return

                setCargando(true)
                setMeses(periodo)
              }}
            >
              {periodo} meses
            </button>
          ))}
        </div>
      </section>

      {error && <div className="inventory-error">{error}</div>}

      <div className={cargando ? 'panorama panorama--actualizando' : 'panorama'}>
        <Crecimiento datos={datos} />

        <div className="panorama-mitades">
          <Departamentos datos={datos} />
          <Horario datos={datos} />
        </div>

        <Productos datos={datos} />

        <div className="panorama-mitades">
          <Entradas datos={datos} />
          <Dinero datos={datos} />
        </div>
      </div>
    </div>
  )
}


function Pregunta({ titulo, respuesta }: { titulo: string, respuesta: string }) {
  return (
    <header className="panorama-pregunta">
      <h3>{titulo}</h3>
      <p>{respuesta}</p>
    </header>
  )
}


// ---------------------------------------------------------
// ¿Estoy creciendo?
// ---------------------------------------------------------

function Crecimiento({ datos }: { datos: Analisis }) {
  // Los meses sin ventas antes de la primera venta no dicen nada
  const primero = datos.meses.findIndex(m => m.ventas > 0)
  const visibles = primero < 0 ? [] : datos.meses.slice(primero)
  const mesActual = datos.hoy.slice(0, 7)
  const completos = visibles.filter(m => m.mes !== mesActual)
  const ultimo = completos[completos.length - 1]
  const penultimo = completos[completos.length - 2]
  const mejor = visibles.reduce<(typeof visibles)[number] | null>(
    (lider, m) => (lider === null || m.ventas > lider.ventas ? m : lider),
    null,
  )

  let respuesta = 'Todavía no hay ventas en este período.'

  if (mejor) {
    const frases = [`Tu mejor mes fue ${nombreMes(mejor.mes)}, con ${dinero(mejor.ventas)}.`]

    if (ultimo && penultimo && penultimo.ventas > 0) {
      const cambio = Math.round(((ultimo.ventas - penultimo.ventas) / penultimo.ventas) * 100)

      frases.push(
        cambio === 0
          ? `${conMayuscula(nombreMes(ultimo.mes))} vendió igual que ${nombreMes(penultimo.mes)}.`
          : `${conMayuscula(nombreMes(ultimo.mes))} ${cambio > 0 ? 'creció' : 'bajó'} ${Math.abs(cambio)} % frente a ${nombreMes(penultimo.mes)}.`,
      )
    }

    if (visibles.some(m => m.mes === mesActual)) {
      frases.push(`${conMayuscula(nombreMes(mesActual))} todavía está en curso.`)
    }

    respuesta = frases.join(' ')
  }

  return (
    <section className="owner-dashboard-card panorama-tarjeta">
      <Pregunta titulo="¿Estoy creciendo?" respuesta={respuesta} />

      {visibles.length > 0 && (
        <>
          <GraficoLineas
            titulo="Ventas y ganancia bruta de cada mes"
            etiquetas={visibles.map(m => conMayuscula(nombreMes(m.mes, true)))}
            marcas={visibles.map((_, indice) => indice)}
            series={[
              { nombre: 'Ventas', color: COLORES.uno, valores: visibles.map(m => m.ventas) },
              { nombre: 'Ganancia bruta', color: COLORES.dos, valores: visibles.map(m => m.neto - m.costo) },
            ]}
          />

          <VerDatos
            columnas={['Mes', 'Ventas', 'Ganancia bruta', 'Margen', 'Cantidad de ventas']}
            filas={visibles.map(m => {
              const porciento = margen(m.neto, m.costo)

              return [
                conMayuscula(nombreMes(m.mes)),
                dinero(m.ventas),
                dinero(m.neto - m.costo),
                porciento === null ? '—' : `${porciento} %`,
                String(m.operaciones),
              ]
            })}
          />
        </>
      )}
    </section>
  )
}


// ---------------------------------------------------------
// ¿Qué departamentos dejan más dinero?
// ---------------------------------------------------------

function Departamentos({ datos }: { datos: Analisis }) {
  const total = datos.departamentos.reduce((suma, d) => suma + (d.neto - d.costo), 0)
  const lider = datos.departamentos[0]
  const principales = datos.departamentos.slice(0, MAX_DEPARTAMENTOS)
  const resto = datos.departamentos.slice(MAX_DEPARTAMENTOS)

  const filas = principales.map(d => ({
    nombre: d.nombre,
    valor: d.neto - d.costo,
    nota: `${margen(d.neto, d.costo) ?? 0} % de margen`,
  }))

  if (resto.length > 0) {
    const neto = resto.reduce((suma, d) => suma + d.neto, 0)
    const costo = resto.reduce((suma, d) => suma + d.costo, 0)

    filas.push({ nombre: `Otros (${resto.length})`, valor: neto - costo, nota: `${margen(neto, costo) ?? 0} % de margen` })
  }

  return (
    <section className="owner-dashboard-card panorama-tarjeta">
      <Pregunta
        titulo="¿Qué departamentos dejan más dinero?"
        respuesta={
          lider
            ? `${lider.nombre} aporta ${porcentaje(lider.neto - lider.costo, total)} % de tu ganancia bruta.`
            : 'Todavía no hay ventas en este período.'
        }
      />

      {filas.length > 0 && <BarrasRanking filas={filas} color={COLORES.uno} />}
    </section>
  )
}


// ---------------------------------------------------------
// ¿Cuándo se vende más?
// ---------------------------------------------------------

function Horario({ datos }: { datos: Analisis }) {
  const celdas = datos.horario.map(h => {
    const columna = FRANJAS.findIndex(f => f.id === h.franja)

    return {
      fila: h.dia - 1,
      columna,
      valor: h.total,
      detalle: `${conMayuscula(DIAS_LARGOS[h.dia - 1])} ${FRANJAS[columna].frase}: ${dinero(h.total)} en ${h.operaciones === 1 ? '1 venta' : `${h.operaciones} ventas`}`,
    }
  })

  const mejor = datos.horario.reduce<(typeof datos.horario)[number] | null>(
    (lider, h) => (lider === null || h.total > lider.total ? h : lider),
    null,
  )

  return (
    <section className="owner-dashboard-card panorama-tarjeta">
      <Pregunta
        titulo="¿Cuándo se vende más?"
        respuesta={
          mejor
            ? `Tu mejor momento es el ${DIAS_LARGOS[mejor.dia - 1]} ${FRANJAS.find(f => f.id === mejor.franja)?.frase}. Te sirve para decidir turnos y horarios.`
            : 'Todavía no hay ventas en este período.'
        }
      />

      {celdas.length > 0 && (
        <>
          <MapaCalor
            filas={DIAS_SEMANA}
            columnas={FRANJAS.map(f => f.texto)}
            celdas={celdas}
            ayuda="Pasa sobre un cuadro para ver el monto."
          />

          <VerDatos
            columnas={['Momento', 'Vendido', 'Ventas']}
            filas={[...datos.horario]
              .sort((a, b) => b.total - a.total)
              .map(h => [
                `${conMayuscula(DIAS_LARGOS[h.dia - 1])} ${FRANJAS.find(f => f.id === h.franja)?.frase}`,
                dinero(h.total),
                String(h.operaciones),
              ])}
          />
        </>
      )}
    </section>
  )
}


// ---------------------------------------------------------
// ¿Qué productos dejan dinero de verdad?
// ---------------------------------------------------------

function Productos({ datos }: { datos: Analisis }) {
  const cuantos = productosDelOchenta(datos.productos)
  const grupos = clasificarProductos(datos.productos)
  const vendidos = datos.productos.length

  return (
    <section className="owner-dashboard-card panorama-tarjeta">
      <Pregunta
        titulo="¿Qué productos dejan dinero de verdad?"
        respuesta={
          vendidos === 0
            ? 'Todavía no hay ventas en este período.'
            : `Vendiste ${vendidos} de tus ${datos.productos_activos} productos activos, y ${cuantos === 1 ? '1 solo genera' : `${cuantos} generan`} el 80 % de tu ganancia bruta.`
        }
      />

      {vendidos > 0 && (
        <div className="panorama-cuadrantes">
          {grupos.map(grupo => (
            <article key={grupo.id} className="panorama-cuadrante">
              <h4>{grupo.titulo}</h4>
              <p>{grupo.consejo}</p>

              {grupo.productos.length === 0 ? (
                <small>Ningún producto aquí.</small>
              ) : (
                <ul>
                  {grupo.productos.slice(0, MAX_POR_GRUPO).map(producto => (
                    <li key={producto.nombre}>
                      <span>{producto.nombre}</span>
                      <small>{margen(producto.neto, producto.costo) ?? 0} %</small>
                    </li>
                  ))}
                  {grupo.productos.length > MAX_POR_GRUPO && (
                    <li className="panorama-cuadrante-mas">y {grupo.productos.length - MAX_POR_GRUPO} más</li>
                  )}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}

      {vendidos > 0 && <p className="panorama-nota">El porcentaje es el margen de cada producto.</p>}
    </section>
  )
}


// ---------------------------------------------------------
// ¿Por dónde entra el dinero?
// ---------------------------------------------------------

function Entradas({ datos }: { datos: Analisis }) {
  const { mostrador, orden_tienda: ordenTienda, en_linea: enLinea } = datos.canales
  const total = mostrador + ordenTienda + enLinea
  const digital = enLinea + ordenTienda
  const { contado, credito } = datos.pago
  const { identificados, recurrentes, monto_identificado: montoIdentificado, monto_top5: montoTop5 } = datos.clientes

  return (
    <section className="owner-dashboard-card panorama-tarjeta">
      <Pregunta
        titulo="¿Por dónde entra el dinero?"
        respuesta={
          total > 0
            ? `${porcentaje(digital, total)} % de lo que vendes empezó en tu tienda en línea. ${porcentaje(contado, contado + credito)} % se vendió de contado.`
            : 'Todavía no hay ventas en este período.'
        }
      />

      {total > 0 && (
        <BarraPartida
          etiqueta="Ventas por canal"
          partes={[
            { nombre: 'Mostrador', valor: mostrador, color: COLORES.uno, tinta: '#ffffff' },
            { nombre: 'Lista hecha en la tienda', valor: ordenTienda, color: COLORES.dos, tinta: '#27264d' },
            { nombre: 'Pedido en línea', valor: enLinea, color: COLORES.tres, tinta: '#27264d' },
          ]}
        />
      )}

      {identificados > 0 && (
        <p className="panorama-nota">
          {recurrentes} de {identificados === 1 ? '1 cliente identificado' : `${identificados} clientes identificados`} {recurrentes === 1 ? 'volvió' : 'volvieron'} a comprar.
          {identificados > 5 ? ` Tus 5 mejores clientes suman ${porcentaje(montoTop5, montoIdentificado)} % de lo que te compran los clientes identificados.` : ''}
        </p>
      )}
    </section>
  )
}


// ---------------------------------------------------------
// ¿Dónde está parado mi dinero?
// ---------------------------------------------------------

function Dinero({ datos }: { datos: Analisis }) {
  const { dinero: d } = datos
  const porCobrar = d.cobro_al_dia + d.cobro_1_30 + d.cobro_31_60 + d.cobro_mas_60
  const dias = duracionInventario(d.inventario, d.costo_vendido_90)

  return (
    <section className="owner-dashboard-card panorama-tarjeta">
      <Pregunta
        titulo="¿Dónde está parado mi dinero?"
        respuesta={`Tienes ${dinero(d.inventario)} en mercadería a precio de costo.${dias === null ? ' No hubo ventas en los últimos 90 días para calcular cuánto te dura.' : ` Al ritmo de los últimos 90 días, te alcanza para ${textoDuracion(dias)}.`}`}
      />

      <dl className="panorama-cifras">
        <div>
          <dt>Sin venderse en 60 días</dt>
          <dd>{dinero(d.sin_movimiento)}</dd>
          <small>{porcentaje(d.sin_movimiento, d.inventario)} % de tu mercadería</small>
        </div>
        <div>
          <dt>Te deben</dt>
          <dd>{dinero(porCobrar)}</dd>
          <small>{porCobrar > 0 ? `${porcentaje(porCobrar - d.cobro_al_dia, porCobrar)} % ya venció` : 'Nadie te debe'}</small>
        </div>
      </dl>

      {porCobrar > 0 && (
        <BarraPartida
          etiqueta="Antigüedad de lo que te deben"
          partes={[
            { nombre: 'Sin vencer', valor: d.cobro_al_dia, color: COLORES.uno, tinta: '#ffffff' },
            { nombre: 'Vencido hasta 30 días', valor: d.cobro_1_30, color: COLORES.tres, tinta: '#27264d' },
            { nombre: 'Vencido más de 30 días', valor: d.cobro_31_60 + d.cobro_mas_60, color: COLORES.dos, tinta: '#27264d' },
          ]}
        />
      )}
    </section>
  )
}
