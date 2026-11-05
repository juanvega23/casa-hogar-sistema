// Textos y formatos compartidos de Incidencias, Equipos de TI y Respaldos.

// Subtítulo de cada pantalla, por id de menú sin "-consulta"
export const DESCRIPCIONES_SOPORTE: Record<string, string> = {
  'soporte-panel': 'Resumen de lo pendiente en Soporte TI.',
  incidencias: 'Problemas reportados por el personal.',
  'equipos-ti': 'Equipos de la empresa y quién los tiene.',
  respaldos: 'Copias de seguridad y pruebas de restauración.',
}

export const TIPOS_INCIDENCIA: Record<string, string> = {
  sistema: 'Sistema',
  equipo: 'Equipo',
  acceso: 'Acceso',
  red: 'Red / Internet',
}

export const IMPACTOS: Record<string, string> = {
  bloquea: 'Me impide trabajar',
  parcial: 'Me impide en parte',
  no: 'No me impide trabajar',
}

export const PRIORIDADES: Record<string, string> = {
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
}

export const ESTADOS_INCIDENCIA: Record<string, string> = {
  abierta: 'Abierta',
  en_atencion: 'En atención',
  resuelta: 'Resuelta',
  cerrada: 'Cerrada',
}

export const TIPOS_EQUIPO: Record<string, string> = {
  laptop: 'Laptop',
  computadora: 'Computadora',
  ups: 'UPS',
  impresora: 'Impresora',
  red: 'Equipo de red',
  otro: 'Otro',
}

export const ESTADOS_EQUIPO: Record<string, string> = {
  por_adquirir: 'Por adquirir',
  disponible: 'Disponible',
  asignado: 'Asignado',
  en_reparacion: 'En reparación',
  baja: 'Dado de baja',
}

export function clasePrioridad(prioridad: string) {
  if (prioridad === 'alta') return 'history-status history-status--danger'
  if (prioridad === 'media') return 'history-status history-status--pending'
  return 'history-status soporte-estado-neutro'
}

export function claseEstadoIncidencia(estado: string) {
  if (estado === 'abierta') return 'history-status history-status--danger'
  if (estado === 'en_atencion') return 'history-status history-status--pending'
  if (estado === 'resuelta') return 'history-status quote-status--info'
  return 'history-status history-status--ok'
}

export function claseEstadoEquipo(estado: string) {
  if (estado === 'asignado') return 'history-status history-status--ok'
  if (estado === 'en_reparacion') return 'history-status history-status--pending'
  if (estado === 'baja') return 'history-status history-status--danger'
  if (estado === 'disponible') return 'history-status quote-status--info'
  return 'history-status soporte-estado-neutro'
}

export function fechaHora(valor: string | null) {
  if (!valor) return '—'

  return new Date(valor).toLocaleString('es-NI', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Las fechas sin hora de la base (AAAA-MM-DD) no deben correrse por la zona horaria
export function fechaCorta(valor: string | null) {
  if (!valor) return '—'

  const [anio, mes, dia] = valor.slice(0, 10).split('-')

  return `${dia}/${mes}/${anio}`
}

export function cordobas(valor: number | null) {
  if (valor === null) return '—'

  return new Intl.NumberFormat('es-NI', {
    style: 'currency',
    currency: 'NIO',
    minimumFractionDigits: 2,
  }).format(valor)
}

export function hoyManagua() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Managua' })
}

export type EventoHistorial = {
  accion: string
  detalle: string | null
  usuario: string
  created_at: string
}
