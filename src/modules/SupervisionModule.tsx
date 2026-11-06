import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'
import { menusByRole } from '../config/roleMenus'
import Paginador from './Paginador'
import { usePaginacion } from '../lib/paginacion'


// ==========================================================
// PANEL DE SUPERVISIÓN (GERENCIA)
//
// Situaciones del día a día que alguien tiene que resolver.
// Gerencia no las resuelve aquí: ve qué pasa, quién debe
// actuar y abre el módulo de consulta correspondiente.
// Datos: alertas_supervision_gerencia().
// ==========================================================

type Area =
  | 'inventario'
  | 'compras'
  | 'ventas'
  | 'cartera'
  | 'caja'

type Prioridad =
  | 'critica'
  | 'alta'
  | 'media'
  | 'baja'

type Alerta = {
  area: Area
  prioridad: Prioridad
  fecha: string
  referencia: string
  titulo: string
  mensaje: string
  accion: string
  modulo: string
}

type Supervision = {
  generadoEn: string
  alertas: Alerta[]
}

type SupervisionModuleProps = {
  onAbrirModulo: (id: string) => void
}

const AREAS: { id: Area, nombre: string }[] = [
  { id: 'inventario', nombre: 'Inventario' },
  { id: 'compras', nombre: 'Compras' },
  { id: 'ventas', nombre: 'Ventas' },
  { id: 'cartera', nombre: 'Cobros' },
  { id: 'caja', nombre: 'Caja' },
]

const PRIORIDADES: Record<Prioridad, string> = {
  critica: 'Urgente',
  alta: 'Alta',
  media: 'Media',
  baja: 'Aviso',
}

const ORDEN_PRIORIDAD: Prioridad[] = ['critica', 'alta', 'media', 'baja']

const NIVELES: Record<Prioridad, [string, string]> = {
  critica: ['urgente', 'urgentes'],
  alta: ['alta', 'altas'],
  media: ['media', 'medias'],
  baja: ['aviso', 'avisos'],
}

// "4 urgentes · 8 altas": cuántas hay de cada nivel, de la más grave a la menos grave
function resumirNiveles(alertas: Alerta[]) {
  return ORDEN_PRIORIDAD
    .map(nivel => {
      const cantidad = alertas.filter(alerta => alerta.prioridad === nivel).length

      return cantidad
        ? `${cantidad} ${NIVELES[nivel][cantidad === 1 ? 0 : 1]}`
        : ''
    })
    .filter(Boolean)
    .join(' · ')
}

// Nombre del módulo tal como aparece en el menú de Gerencia
const NOMBRES_MODULO = new Map(
  menusByRole.gerencia
    .flatMap(item => item.children ?? [item])
    .map(item => [item.id, item.nombre]),
)

function fechaHora(valor: string) {
  return new Intl.DateTimeFormat('es-NI', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(valor))
}

export default function SupervisionModule({
  onAbrirModulo,
}: SupervisionModuleProps) {
  const [datos, setDatos] = useState<Supervision | null>(null)
  const [area, setArea] = useState<Area | 'todas'>('todas')
  const [nivel, setNivel] = useState<Prioridad | 'todos'>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  function pedirAlertas() {
    return supabase
      .rpc('alertas_supervision_gerencia')
      .then(({ data, error: rpcError }) => {
        setCargando(false)

        if (rpcError) {
          setError(rpcError.message)
          return
        }

        const raw = (data ?? {}) as {
          generado_en?: string
          alertas?: Alerta[]
        }

        setDatos({
          generadoEn: raw.generado_en ?? new Date().toISOString(),
          alertas: Array.isArray(raw.alertas) ? raw.alertas : [],
        })
      })
  }

  function cargar() {
    setCargando(true)
    setError('')
    void pedirAlertas()
  }

  useEffect(() => {
    void pedirAlertas()
  }, [])

  const porArea = useMemo(() => {
    const conteo = new Map<Area, { total: number, mayor: Prioridad | null, niveles: Alerta[] }>()

    for (const { id } of AREAS) {
      conteo.set(id, { total: 0, mayor: null, niveles: [] })
    }

    for (const alerta of datos?.alertas ?? []) {
      const actual = conteo.get(alerta.area)

      if (!actual) continue

      actual.total += 1
      actual.niveles.push(alerta)

      if (
        !actual.mayor ||
        ORDEN_PRIORIDAD.indexOf(alerta.prioridad) <
          ORDEN_PRIORIDAD.indexOf(actual.mayor)
      ) {
        actual.mayor = alerta.prioridad
      }
    }

    return conteo
  }, [datos])

  const delArea = (datos?.alertas ?? []).filter(
    alerta => area === 'todas' || alerta.area === area,
  )

  const termino = busqueda.trim().toLowerCase()

  const visibles = delArea.filter(alerta =>
    (nivel === 'todos' || alerta.prioridad === nivel) &&
    (!termino || [alerta.titulo, alerta.referencia, alerta.mensaje]
      .some(texto => (texto ?? '').toLowerCase().includes(termino))),
  )

  const paginacion = usePaginacion(visibles, 20)

  if (cargando && !datos) {
    return (
      <div className="owner-dashboard-loading">
        <div className="inventory-spinner" />
        <span>Revisando la operación...</span>
      </div>
    )
  }

  return (
    <div className="alertas-modulo">
      <section className="alertas-encabezado">
        <div>
          <span className="section-kicker">SUPERVISIÓN</span>
          <h2>Lo que necesita atención</h2>
          <p>
            Situaciones pendientes en todas las áreas, quién debe resolverlas y dónde
            consultarlas. Las operaciones las hace cada responsable; aquí se da seguimiento.
          </p>
        </div>

        <button
          type="button"
          className="product-secondary-button"
          onClick={cargar}
          disabled={cargando}
        >
          {cargando ? 'Actualizando...' : 'Actualizar'}
        </button>
      </section>

      {error && (
        <div className="inventory-error">{error}</div>
      )}

      {datos && (
        <>
          <section className="alertas-areas" aria-label="Filtrar por área">
            <button
              type="button"
              className={area === 'todas' ? 'alertas-area is-activa' : 'alertas-area'}
              onClick={() => setArea('todas')}
            >
              <span>Todas</span>
              <strong>{datos.alertas.length}</strong>
              <small>{resumirNiveles(datos.alertas) || 'Todo al día'}</small>
            </button>

            {AREAS.map(({ id, nombre }) => {
              const conteo = porArea.get(id)

              return (
                <button
                  key={id}
                  type="button"
                  className={[
                    'alertas-area',
                    area === id ? 'is-activa' : '',
                    conteo?.mayor ? `alertas-area--${conteo.mayor}` : '',
                  ].join(' ').trim()}
                  onClick={() => setArea(id)}
                  disabled={!conteo?.total}
                >
                  <span>{nombre}</span>
                  <strong>{conteo?.total ?? 0}</strong>
                  <small>{resumirNiveles(conteo?.niveles ?? []) || 'Al día'}</small>
                </button>
              )
            })}
          </section>

          <section className="alertas-filtros" aria-label="Filtrar alertas">
            <div className="alertas-niveles" role="group" aria-label="Nivel de prioridad">
              <button
                type="button"
                className={nivel === 'todos' ? 'alertas-nivel is-activo' : 'alertas-nivel'}
                aria-pressed={nivel === 'todos'}
                onClick={() => setNivel('todos')}
              >
                Todos <b>{delArea.length}</b>
              </button>

              {ORDEN_PRIORIDAD.map(opcion => {
                const cantidad = delArea.filter(alerta => alerta.prioridad === opcion).length

                return (
                  <button
                    key={opcion}
                    type="button"
                    className={nivel === opcion ? 'alertas-nivel is-activo' : 'alertas-nivel'}
                    aria-pressed={nivel === opcion}
                    disabled={cantidad === 0}
                    onClick={() => setNivel(opcion)}
                  >
                    {PRIORIDADES[opcion]} <b>{cantidad}</b>
                  </button>
                )
              })}
            </div>

            <div className="clients-search">
              <span>⌕</span>
              <input
                type="text"
                value={busqueda}
                onChange={event => setBusqueda(event.target.value)}
                placeholder="Buscar por producto, cliente, número o situación..."
              />
            </div>
          </section>

          {visibles.length === 0 ? (
            <div className="alertas-vacio">
              <strong>Todo al día</strong>
              <span>No hay situaciones pendientes en esta área.</span>
            </div>
          ) : (
            <div>
            <ul className="alertas-lista">
              {paginacion.visibles.map((alerta, indice) => (
                <li
                  key={`${alerta.area}-${alerta.referencia}-${indice}`}
                  className={`alerta-item alerta-item--${alerta.prioridad}`}
                >
                  <div className="alerta-item-cabeza">
                    <span className={`alerta-prioridad alerta-prioridad--${alerta.prioridad}`}>
                      {PRIORIDADES[alerta.prioridad]}
                    </span>

                    <strong>{alerta.titulo}</strong>

                    <span className="alerta-referencia">{alerta.referencia}</span>
                  </div>

                  <p>{alerta.mensaje}</p>

                  <div className="alerta-item-pie">
                    <span className="alerta-que-hacer">
                      <b>Qué hacer:</b> {alerta.accion}
                    </span>

                    {NOMBRES_MODULO.has(alerta.modulo) && (
                      <button
                        type="button"
                        className="alerta-ir"
                        onClick={() => onAbrirModulo(alerta.modulo)}
                      >
                        Ver en {NOMBRES_MODULO.get(alerta.modulo)} →
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <Paginador control={paginacion} />
            </div>
          )}

          <div className="alertas-actualizado">
            Revisado: {fechaHora(datos.generadoEn)}
          </div>
        </>
      )}
    </div>
  )
}
