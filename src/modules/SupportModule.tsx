import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'

import { FunctionsHttpError } from '@supabase/supabase-js'

import { supabase } from '../lib/supabase'

import {
  menusByRole,
  type RoleCode,
} from '../config/roleMenus'

type SupportModuleProps = {
  roleCode: string
  vista: string
}

type Rol = {
  id: number
  codigo: string
  nombre: string
  descripcion: string | null
}

type UsuarioInterno = {
  id: string
  nombre_completo: string | null
  correo: string | null
  role_id: number | null
  rol_codigo: string | null
  rol_nombre: string | null
  activo: boolean
  ultimo_acceso: string | null
  created_at: string
}

type EventoAuditoria = {
  fecha: string
  modulo: string
  accion: string
  referencia: string | null
  detalle: string | null
  usuario: string
}

type ResumenSistema = {
  generado_en: string
  usuarios: { activos: number; inactivos: number; sin_rol: number }
  por_rol: { codigo: string; nombre: string; activos: number }[]
  clientes_web: { total: number; activos: number }
  catalogo: { productos_activos: number; con_imagen: number }
  servicios: { bucket_productos: boolean; tareas_programadas: boolean }
}

// Roles que se conservan solo por compatibilidad (ver CLAUDE.md §8).
const ROLES_ANTIGUOS = ['ventas', 'administracion']

function formatearFecha(valor: string | null) {
  if (!valor) return '—'
  return new Intl.DateTimeFormat('es-NI', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(valor))
}

/*
 * Contraseña temporal legible (sin caracteres ambiguos como 0/O
 * o 1/l) generada con el generador criptográfico del navegador.
 */
function generarClaveTemporal() {
  const alfabeto =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const valores = new Uint32Array(12)
  crypto.getRandomValues(valores)
  return Array.from(valores, v => alfabeto[v % alfabeto.length]).join('')
}

async function mensajeDeFuncion(error: unknown) {
  if (error instanceof FunctionsHttpError) {
    try {
      const cuerpo = await error.context.json()
      if (cuerpo?.error) return String(cuerpo.error)
    } catch {
      // Respuesta sin JSON.
    }
  }

  return error instanceof Error
    ? error.message
    : 'No fue posible completar la operación.'
}

function modulosDeRol(codigo: string) {
  const menu = menusByRole[codigo as RoleCode] ?? []

  return menu.map(item =>
    item.children?.length
      ? `${item.nombre}: ${item.children.map(c => c.nombre).join(', ')}`
      : item.nombre,
  )
}

export default function SupportModule({
  roleCode,
  vista,
}: SupportModuleProps) {
  const esSoporte = roleCode === 'soporte_ti'

  const [usuarios, setUsuarios] = useState<UsuarioInterno[]>([])
  const [roles, setRoles] = useState<Rol[]>([])
  const [eventos, setEventos] = useState<EventoAuditoria[]>([])
  const [resumen, setResumen] = useState<ResumenSistema | null>(null)

  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  // Usuarios: búsqueda y filtros
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('activos')

  // Alta
  const [mostrarAlta, setMostrarAlta] = useState(false)
  const [altaNombre, setAltaNombre] = useState('')
  const [altaCorreo, setAltaCorreo] = useState('')
  const [altaRol, setAltaRol] = useState('')
  const [altaClave, setAltaClave] = useState('')

  // Edición
  const [editando, setEditando] = useState<UsuarioInterno | null>(null)
  const [editNombre, setEditNombre] = useState('')
  const [editRol, setEditRol] = useState('')
  const [editActivo, setEditActivo] = useState(true)
  const [nuevaClave, setNuevaClave] = useState('')

  // Auditoría
  const [filtroModulo, setFiltroModulo] = useState('todos')
  const [busquedaAuditoria, setBusquedaAuditoria] = useState('')

  const [miId, setMiId] = useState<string | null>(null)

  async function cargarDatos() {
    if (!esSoporte) {
      setCargando(false)
      return
    }

    setCargando(true)
    setError('')

    const { data: sesion } = await supabase.auth.getUser()
    setMiId(sesion.user?.id ?? null)

    const necesitaUsuarios = vista === 'usuarios' || vista === 'roles'

    const [rolesResp, usuariosResp, auditoriaResp, resumenResp] =
      await Promise.all([
        supabase
          .from('roles')
          .select('id, codigo, nombre, descripcion')
          .order('nombre', { ascending: true }),

        necesitaUsuarios
          ? supabase.rpc('listar_usuarios_internos')
          : Promise.resolve({ data: [], error: null }),

        vista === 'auditoria'
          ? supabase.rpc('auditoria_sistema', { p_limite: 300 })
          : Promise.resolve({ data: [], error: null }),

        vista === 'configuracion'
          ? supabase.rpc('resumen_sistema_soporte')
          : Promise.resolve({ data: null, error: null }),
      ])

    const primeraError =
      rolesResp.error ||
      usuariosResp.error ||
      auditoriaResp.error ||
      resumenResp.error

    if (primeraError) {
      setError(primeraError.message)
      setCargando(false)
      return
    }

    setRoles(
      (rolesResp.data ?? []).map(r => ({ ...r, id: Number(r.id) })) as Rol[],
    )

    setUsuarios(
      ((usuariosResp.data ?? []) as UsuarioInterno[]).map(u => ({
        ...u,
        role_id: u.role_id === null ? null : Number(u.role_id),
      })),
    )

    setEventos((auditoriaResp.data ?? []) as EventoAuditoria[])
    setResumen((resumenResp.data ?? null) as ResumenSistema | null)

    setCargando(false)
  }

  useEffect(() => {
    void cargarDatos()
  }, [roleCode, vista])

  function limpiarMensajes() {
    setError('')
    setExito('')
  }

  const usuariosFiltrados = useMemo(() => {
    const termino = busqueda.trim().toLowerCase()

    return usuarios.filter(u => {
      const coincideBusqueda =
        !termino ||
        (u.nombre_completo ?? '').toLowerCase().includes(termino) ||
        (u.correo ?? '').toLowerCase().includes(termino) ||
        (u.rol_nombre ?? '').toLowerCase().includes(termino)

      const coincideEstado =
        filtroEstado === 'todos' ||
        (filtroEstado === 'activos' && u.activo) ||
        (filtroEstado === 'inactivos' && !u.activo) ||
        (filtroEstado === 'sin_rol' && u.role_id === null)

      return coincideBusqueda && coincideEstado
    })
  }, [usuarios, busqueda, filtroEstado])

  const eventosFiltrados = useMemo(() => {
    const termino = busquedaAuditoria.trim().toLowerCase()

    return eventos.filter(e => {
      const coincideModulo =
        filtroModulo === 'todos' || e.modulo === filtroModulo

      const coincideBusqueda =
        !termino ||
        e.accion.toLowerCase().includes(termino) ||
        (e.referencia ?? '').toLowerCase().includes(termino) ||
        (e.detalle ?? '').toLowerCase().includes(termino) ||
        e.usuario.toLowerCase().includes(termino)

      return coincideModulo && coincideBusqueda
    })
  }, [eventos, filtroModulo, busquedaAuditoria])

  // ==========================================================
  // ACCIONES
  // ==========================================================

  function abrirAlta() {
    limpiarMensajes()
    setEditando(null)
    setAltaNombre('')
    setAltaCorreo('')
    setAltaRol('')
    setAltaClave(generarClaveTemporal())
    setMostrarAlta(true)
  }

  async function crearUsuario(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    limpiarMensajes()

    if (!altaRol) {
      setError('Selecciona el rol del nuevo usuario.')
      return
    }

    setProcesando(true)

    const { error: funcionError } = await supabase.functions.invoke(
      'gestionar-usuarios',
      {
        body: {
          accion: 'crear',
          nombre: altaNombre.trim(),
          correo: altaCorreo.trim(),
          role_id: Number(altaRol),
          clave: altaClave,
        },
      },
    )

    if (funcionError) {
      setError(await mensajeDeFuncion(funcionError))
      setProcesando(false)
      return
    }

    setExito(
      `Usuario ${altaCorreo.trim()} creado. Contraseña temporal: ${altaClave} — entrégala de forma segura; el usuario puede cambiarla desde "Cambiar contraseña".`,
    )
    setMostrarAlta(false)
    await cargarDatos()
    setProcesando(false)
  }

  function abrirEdicion(usuario: UsuarioInterno) {
    limpiarMensajes()
    setMostrarAlta(false)
    setEditando(usuario)
    setEditNombre(usuario.nombre_completo ?? '')
    setEditRol(usuario.role_id ? String(usuario.role_id) : '')
    setEditActivo(usuario.activo)
    setNuevaClave('')
  }

  async function guardarEdicion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editando) return

    limpiarMensajes()

    if (!editRol) {
      setError('Selecciona un rol.')
      return
    }

    setProcesando(true)

    const { error: rpcError } = await supabase.rpc(
      'actualizar_usuario_interno',
      {
        p_usuario_id: editando.id,
        p_nombre: editNombre.trim(),
        p_role_id: Number(editRol),
        p_activo: editActivo,
      },
    )

    if (rpcError) {
      setError(rpcError.message)
      setProcesando(false)
      return
    }

    setExito(`Usuario ${editando.correo ?? editNombre} actualizado.`)
    setEditando(null)
    await cargarDatos()
    setProcesando(false)
  }

  async function restablecerClave() {
    if (!editando) return

    limpiarMensajes()

    if (nuevaClave.length < 8) {
      setError('La contraseña temporal debe tener al menos 8 caracteres.')
      return
    }

    setProcesando(true)

    const { error: funcionError } = await supabase.functions.invoke(
      'gestionar-usuarios',
      {
        body: {
          accion: 'restablecer_clave',
          usuario_id: editando.id,
          clave: nuevaClave,
        },
      },
    )

    setProcesando(false)

    if (funcionError) {
      setError(await mensajeDeFuncion(funcionError))
      return
    }

    setExito(
      `Contraseña temporal de ${editando.correo ?? 'el usuario'}: ${nuevaClave} — entrégala de forma segura.`,
    )
    setNuevaClave('')
  }

  // ==========================================================
  // RENDER
  // ==========================================================

  if (!esSoporte) {
    return (
      <div className="inventory-error">
        Este módulo es exclusivo de Soporte TI.
      </div>
    )
  }

  if (cargando) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />
        <span>Cargando...</span>
      </div>
    )
  }

  const mensajes = (
    <>
      {error && <div className="inventory-error">{error}</div>}
      {exito && <div className="movement-success">{exito}</div>}
    </>
  )

  const rolesAsignables = roles.filter(
    r => !ROLES_ANTIGUOS.includes(r.codigo),
  )

  // ---------------------------------------------------------
  // ROLES Y PERMISOS
  // ---------------------------------------------------------

  if (vista === 'roles') {
    return (
      <div className="history-module">
        <section className="history-toolbar">
          <div>
            <span className="panel-label">SEGURIDAD</span>
            <h2>Roles y permisos</h2>
            <p>
              Cada rol ve solo los módulos de su menú. Los permisos reales se aplican en la base de datos (RLS y funciones), no solo en la interfaz.
            </p>
          </div>

          <button
            type="button"
            className="inventory-refresh-button"
            onClick={() => void cargarDatos()}
          >
            ↻ Actualizar
          </button>
        </section>

        {mensajes}

        <section className="history-list-card">
          <div className="history-table-wrap">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Rol</th>
                  <th>Usuarios activos</th>
                  <th>Módulos habilitados</th>
                </tr>
              </thead>
              <tbody>
                {roles.map(rol => {
                  const activos = usuarios.filter(
                    u => u.role_id === rol.id && u.activo,
                  ).length

                  return (
                    <tr key={rol.id}>
                      <td>
                        <strong>{rol.nombre}</strong>
                        <small>
                          {rol.codigo}
                          {ROLES_ANTIGUOS.includes(rol.codigo) && ' · rol antiguo (compatibilidad)'}
                        </small>
                        {rol.descripcion && <small>{rol.descripcion}</small>}
                      </td>
                      <td>{activos}</td>
                      <td>
                        {modulosDeRol(rol.codigo).map(linea => (
                          <small key={linea}>{linea}</small>
                        ))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    )
  }

  // ---------------------------------------------------------
  // AUDITORÍA
  // ---------------------------------------------------------

  if (vista === 'auditoria') {
    const modulos = Array.from(new Set(eventos.map(e => e.modulo))).sort()

    return (
      <div className="history-module">
        <section className="history-toolbar">
          <div>
            <span className="panel-label">TRAZABILIDAD</span>
            <h2>Auditoría</h2>
            <p>
              Gestión de usuarios, anulaciones, autorizaciones de compra, diferencias de caja y ajustes manuales de inventario.
            </p>
          </div>

          <button
            type="button"
            className="inventory-refresh-button"
            onClick={() => void cargarDatos()}
          >
            ↻ Actualizar
          </button>
        </section>

        {mensajes}

        <section className="history-list-card">
          <div className="history-list-head">
            <div>
              <span className="panel-label">EVENTOS</span>
              <h3>Últimos 300 eventos</h3>
            </div>

            <span className="sales-result-count">
              {eventosFiltrados.length} resultado{eventosFiltrados.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="history-filters">
            <div className="clients-search">
              <span>⌕</span>
              <input
                type="text"
                value={busquedaAuditoria}
                onChange={event => setBusquedaAuditoria(event.target.value)}
                placeholder="Buscar por acción, referencia, detalle o usuario..."
              />
            </div>

            <select
              value={filtroModulo}
              onChange={event => setFiltroModulo(event.target.value)}
            >
              <option value="todos">Todos los módulos</option>
              {modulos.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div className="history-table-wrap">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Módulo</th>
                  <th>Acción</th>
                  <th>Referencia</th>
                  <th>Detalle</th>
                  <th>Usuario</th>
                </tr>
              </thead>
              <tbody>
                {eventosFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="inventory-empty">
                      No hay eventos registrados.
                    </td>
                  </tr>
                ) : (
                  eventosFiltrados.map((e, indice) => (
                    <tr key={`${e.fecha}-${indice}`}>
                      <td>{formatearFecha(e.fecha)}</td>
                      <td>
                        <span className="history-channel">{e.modulo}</span>
                      </td>
                      <td><strong>{e.accion}</strong></td>
                      <td>{e.referencia ?? '—'}</td>
                      <td>{e.detalle ?? '—'}</td>
                      <td>{e.usuario}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    )
  }

  // ---------------------------------------------------------
  // CONFIGURACIÓN / ESTADO DEL SISTEMA
  // ---------------------------------------------------------

  if (vista === 'configuracion') {
    const origen = window.location.origin

    return (
      <div className="history-module">
        <section className="history-toolbar">
          <div>
            <span className="panel-label">CONFIGURACIÓN</span>
            <h2>Estado del sistema</h2>
            <p>
              Resumen técnico de usuarios, servicios y configuración requerida en Supabase.
            </p>
          </div>

          <button
            type="button"
            className="inventory-refresh-button"
            onClick={() => void cargarDatos()}
          >
            ↻ Actualizar
          </button>
        </section>

        {mensajes}

        {resumen && (
          <>
            <div className="history-summary-grid">
              <article className="history-summary-card">
                <span>PERSONAL ACTIVO</span>
                <strong>{resumen.usuarios.activos}</strong>
                <p>
                  {resumen.usuarios.inactivos} inactivos · {resumen.usuarios.sin_rol} sin rol
                </p>
              </article>

              <article className="history-summary-card">
                <span>CLIENTES WEB</span>
                <strong>{resumen.clientes_web.activos}</strong>
                <p>de {resumen.clientes_web.total} cuentas de la tienda</p>
              </article>

              <article className="history-summary-card">
                <span>CATÁLOGO</span>
                <strong>{resumen.catalogo.productos_activos}</strong>
                <p>{resumen.catalogo.con_imagen} con imagen en la tienda</p>
              </article>

              <article className="history-summary-card">
                <span>SERVICIOS</span>
                <strong>
                  {Number(resumen.servicios.bucket_productos) +
                    Number(resumen.servicios.tareas_programadas)}
                  /2
                </strong>
                <p>servicios configurados</p>
              </article>
            </div>

            <section className="history-list-card">
              <div className="history-list-head">
                <div>
                  <span className="panel-label">SERVICIOS</span>
                  <h3>Componentes de Supabase</h3>
                </div>
              </div>

              <div className="history-table-wrap">
                <table className="history-table">
                  <tbody>
                    <tr>
                      <td><strong>Storage · bucket "productos"</strong><small>Imágenes del catálogo de la tienda</small></td>
                      <td>
                        <span className={resumen.servicios.bucket_productos ? 'history-status history-status--ok' : 'history-status history-status--danger'}>
                          {resumen.servicios.bucket_productos ? 'Configurado' : 'Falta crear'}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td><strong>Tareas programadas (pg_cron)</strong><small>Marca diariamente las cuentas por cobrar vencidas</small></td>
                      <td>
                        <span className={resumen.servicios.tareas_programadas ? 'history-status history-status--ok' : 'history-status history-status--pending'}>
                          {resumen.servicios.tareas_programadas ? 'Activas' : 'No disponibles'}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td><strong>Edge Function "gestionar-usuarios"</strong><small>Alta de personal y contraseñas temporales</small></td>
                      <td><span className="history-status history-status--ok">Usada por este módulo</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        <section className="history-list-card">
          <div className="history-list-head">
            <div>
              <span className="panel-label">AUTENTICACIÓN</span>
              <h3>URLs requeridas en Supabase</h3>
            </div>
          </div>

          <p className="cash-help">
            Supabase → Authentication → URL Configuration. Sin estas URLs no funcionan la confirmación de registro ni la recuperación de contraseña de la tienda.
          </p>

          <div className="history-table-wrap">
            <table className="history-table">
              <tbody>
                <tr>
                  <td><strong>Site URL</strong></td>
                  <td><code>{origen}</code></td>
                </tr>
                <tr>
                  <td><strong>Redirect URL</strong></td>
                  <td><code>{origen}/tienda/login</code></td>
                </tr>
                <tr>
                  <td><strong>Redirect URL</strong></td>
                  <td><code>{origen}/tienda/restablecer</code></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    )
  }

  // ---------------------------------------------------------
  // USUARIOS
  // ---------------------------------------------------------

  const resumenUsuarios = {
    activos: usuarios.filter(u => u.activo && u.role_id !== null).length,
    inactivos: usuarios.filter(u => !u.activo).length,
    sinRol: usuarios.filter(u => u.activo && u.role_id === null).length,
  }

  const editandoAMiMismo = editando?.id === miId

  return (
    <div className="history-module">
      <section className="history-toolbar">
        <div>
          <span className="panel-label">SOPORTE TI</span>
          <h2>Usuarios del sistema</h2>
          <p>
            Cuentas del personal interno. Los clientes de la tienda se registran solos y no aparecen aquí.
          </p>
        </div>

        <div className="product-form-actions">
          <button
            type="button"
            className="inventory-refresh-button"
            onClick={() => void cargarDatos()}
          >
            ↻ Actualizar
          </button>

          <button
            type="button"
            className="product-primary-button"
            onClick={abrirAlta}
          >
            + Nuevo usuario
          </button>
        </div>
      </section>

      <div className="history-summary-grid">
        <article className="history-summary-card">
          <span>ACTIVOS</span>
          <strong>{resumenUsuarios.activos}</strong>
          <p>con rol asignado</p>
        </article>

        <article className="history-summary-card">
          <span>SIN ROL</span>
          <strong>{resumenUsuarios.sinRol}</strong>
          <p>no pueden ingresar todavía</p>
        </article>

        <article className="history-summary-card">
          <span>INACTIVOS</span>
          <strong>{resumenUsuarios.inactivos}</strong>
          <p>acceso bloqueado</p>
        </article>

        <article className="history-summary-card">
          <span>TOTAL</span>
          <strong>{usuarios.length}</strong>
          <p>cuentas internas</p>
        </article>
      </div>

      {mensajes}

      {mostrarAlta && (
        <section className="cash-card">
          <div className="cash-section-head">
            <div>
              <span className="panel-label">ALTA</span>
              <h3>Nuevo usuario interno</h3>
            </div>

            <button
              type="button"
              className="product-close-button"
              onClick={() => setMostrarAlta(false)}
            >
              ×
            </button>
          </div>

          <form className="cash-form" onSubmit={crearUsuario}>
            <label>
              Nombre completo
              <input
                value={altaNombre}
                onChange={event => setAltaNombre(event.target.value)}
                required
                minLength={2}
              />
            </label>

            <label>
              Correo electrónico
              <input
                type="email"
                value={altaCorreo}
                onChange={event => setAltaCorreo(event.target.value)}
                placeholder="nombre@casahogar.com"
                required
              />
            </label>

            <label>
              Rol
              <select
                value={altaRol}
                onChange={event => setAltaRol(event.target.value)}
                required
              >
                <option value="">Seleccionar rol</option>
                {rolesAsignables.map(r => (
                  <option key={r.id} value={r.id}>{r.nombre}</option>
                ))}
              </select>
            </label>

            <label>
              Contraseña temporal
              <input
                value={altaClave}
                onChange={event => setAltaClave(event.target.value)}
                minLength={8}
                required
              />
            </label>

            <div className="cash-actions cash-field-full">
              <button
                type="button"
                className="product-secondary-button"
                onClick={() => setAltaClave(generarClaveTemporal())}
                disabled={procesando}
              >
                Generar otra contraseña
              </button>

              <button
                type="submit"
                className="product-primary-button"
                disabled={procesando}
              >
                {procesando ? 'Creando...' : 'Crear usuario'}
              </button>
            </div>
          </form>
        </section>
      )}

      {editando && (
        <section className="cash-card">
          <div className="cash-section-head">
            <div>
              <span className="panel-label">EDICIÓN</span>
              <h3>{editando.correo ?? editando.nombre_completo}</h3>
            </div>

            <button
              type="button"
              className="product-close-button"
              onClick={() => setEditando(null)}
            >
              ×
            </button>
          </div>

          {editandoAMiMismo && (
            <div className="cash-info-box">
              Es tu propia cuenta: no puedes desactivarla ni cambiar tu rol.
            </div>
          )}

          <form className="cash-form" onSubmit={guardarEdicion}>
            <label>
              Nombre completo
              <input
                value={editNombre}
                onChange={event => setEditNombre(event.target.value)}
                required
                minLength={2}
              />
            </label>

            <label>
              Rol
              <select
                value={editRol}
                onChange={event => setEditRol(event.target.value)}
                disabled={editandoAMiMismo}
                required
              >
                <option value="">Seleccionar rol</option>
                {roles
                  .filter(
                    r =>
                      !ROLES_ANTIGUOS.includes(r.codigo) ||
                      r.id === editando.role_id,
                  )
                  .map(r => (
                    <option key={r.id} value={r.id}>{r.nombre}</option>
                  ))}
              </select>
            </label>

            <label className="product-image-remove">
              <input
                type="checkbox"
                checked={editActivo}
                onChange={event => setEditActivo(event.target.checked)}
                disabled={editandoAMiMismo}
              />
              Cuenta activa
            </label>

            <div className="cash-actions cash-field-full">
              <button
                type="submit"
                className="product-primary-button"
                disabled={procesando}
              >
                {procesando ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>

          <form
            className="cash-form"
            onSubmit={event => {
              event.preventDefault()
              void restablecerClave()
            }}
          >
            <label>
              Nueva contraseña temporal
              <input
                value={nuevaClave}
                onChange={event => setNuevaClave(event.target.value)}
                minLength={8}
                placeholder="Mínimo 8 caracteres"
              />
            </label>

            <div className="cash-actions">
              <button
                type="button"
                className="product-secondary-button"
                onClick={() => setNuevaClave(generarClaveTemporal())}
                disabled={procesando}
              >
                Generar
              </button>

              <button
                type="submit"
                className="product-primary-button"
                disabled={procesando || !nuevaClave}
              >
                Restablecer contraseña
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="history-list-card">
        <div className="history-list-head">
          <div>
            <span className="panel-label">PERSONAL</span>
            <h3>Cuentas internas</h3>
          </div>

          <span className="sales-result-count">
            {usuariosFiltrados.length} resultado{usuariosFiltrados.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="history-filters">
          <div className="clients-search">
            <span>⌕</span>
            <input
              type="text"
              value={busqueda}
              onChange={event => setBusqueda(event.target.value)}
              placeholder="Buscar por nombre, correo o rol..."
            />
          </div>

          <select
            value={filtroEstado}
            onChange={event => setFiltroEstado(event.target.value)}
          >
            <option value="activos">Activos</option>
            <option value="inactivos">Inactivos</option>
            <option value="sin_rol">Sin rol</option>
            <option value="todos">Todos</option>
          </select>
        </div>

        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Último acceso</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuariosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={5} className="inventory-empty">
                    No se encontraron usuarios.
                  </td>
                </tr>
              ) : (
                usuariosFiltrados.map(u => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.nombre_completo ?? 'Sin nombre'}</strong>
                      <small>{u.correo ?? '—'}{u.id === miId ? ' · tú' : ''}</small>
                    </td>
                    <td>{u.rol_nombre ?? 'Sin rol'}</td>
                    <td>
                      <span
                        className={
                          !u.activo
                            ? 'history-status history-status--danger'
                            : u.role_id === null
                              ? 'history-status history-status--pending'
                              : 'history-status history-status--ok'
                        }
                      >
                        {!u.activo ? 'Inactivo' : u.role_id === null ? 'Sin rol' : 'Activo'}
                      </span>
                    </td>
                    <td>{formatearFecha(u.ultimo_acceso)}</td>
                    <td>
                      <button
                        type="button"
                        className="product-edit-button"
                        onClick={() => abrirEdicion(u)}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
