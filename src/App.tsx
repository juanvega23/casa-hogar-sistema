import {
  useEffect,
  useState,
  type FormEvent,
} from 'react'

import { supabase } from './lib/supabase'

import {
  menusByRole,
  type RoleCode,
} from './config/roleMenus'

import InventoryModule from './modules/InventoryModule'
import ProductsModule from './modules/ProductsModule'
import MovementsModule from './modules/MovementsModule'
import ReplenishmentModule from './modules/ReplenishmentModule'
import SalesModule from './modules/SalesModule'
import CashModule from './modules/CashModule'
import SuppliersModule from './modules/SuppliersModule'
import PurchasesModule from './modules/PurchasesModule'
import PurchaseReceptionModule from './modules/PurchaseReceptionModule'
import PurchaseReturnsModule from './modules/PurchaseReturnsModule'

import './App.css'


// =====================================================
// TIPOS
// =====================================================

type Rol = {
  codigo: string
  nombre: string
}

type Perfil = {
  id: string
  nombre_completo: string | null
  activo: boolean
  roles: Rol | null
}

type PerfilRespuesta = {
  id: string
  nombre_completo: string | null
  activo: boolean
  roles: Rol | Rol[] | null
}


// =====================================================
// UTILIDADES
// =====================================================

function obtenerRol(
  roles: Rol | Rol[] | null,
): Rol | null {
  if (!roles) {
    return null
  }

  if (Array.isArray(roles)) {
    return roles[0] ?? null
  }

  return roles
}


function getMenuIcon(id: string) {
  const paths: Record<string, string> = {
    dashboard:
      'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',

    reportes:
      'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',

    inventario:
      'M3 7 12 2l9 5v10l-9 5-9-5z M3 7l9 5 9-5 M12 12v10',

    productos:
      'M3 4h9l9 9-8 8-9-9z M8 8h.01',

    movimientos:
      'M4 7h16 M16 3l4 4-4 4 M20 17H4 M8 13l-4 4 4 4',

    reposicion:
      'M20 11a8 8 0 0 0-14-5L4 8 M4 4v4h4 M4 13a8 8 0 0 0 14 5l2-2 M20 20v-4h-4',

    compras:
      'M5 8h14l1 13H4L5 8z M9 9V6a3 3 0 0 1 6 0v3',

    proveedores:
      'M3 6h11v11H3z M14 10h4l3 3v4h-7z M6 18a2 2 0 1 0 4 0 M16 18a2 2 0 1 0 4 0',

    recepciones:
      'M4 7 12 3l8 4v10l-8 4-8-4z M4 7l8 5 8-5 M12 12v9 M8 15l2 2 4-4',

    devoluciones:
      'M9 14 4 9l5-5 M4 9h11a5 5 0 0 1 5 5v1 M20 15l-4-4 M20 15l-4 4',

    ventas:
      'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6 M9 16h3',

    caja:
      'M3 6h17v14H3z M3 9h17 M16 13h5v4h-5a2 2 0 0 1 0-4z',

    alertas:
      'M12 3 2 21h20L12 3z M12 9v5 M12 18h.01',

    usuarios:
      'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M17 3a4 4 0 0 1 0 8 M22 20v-2a4 4 0 0 0-3-3.87',

    roles:
      'M12 2 4 5v6c0 5 3.4 8.8 8 11 4.6-2.2 8-6 8-11V5z M9 12l2 2 4-4',

    auditoria:
      'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',

    configuracion:
      'M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6 7 7 M17 17l1.4 1.4 M18.4 5.6 17 7 M7 17l-1.4 1.4 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  }

  const key =
    id.replace(
      '-consulta',
      '',
    )

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d={
          paths[key] ??
          paths.dashboard
        }
      />
    </svg>
  )
}


// =====================================================
// APP
// =====================================================

function App() {
  const [email, setEmail] =
    useState('')

  const [password, setPassword] =
    useState('')

  const [mensaje, setMensaje] =
    useState('')

  const [perfil, setPerfil] =
    useState<Perfil | null>(
      null,
    )

  const [userId, setUserId] =
    useState<string | null>(
      null,
    )

  const [cargando, setCargando] =
    useState(true)

  const [
    menuAbierto,
    setMenuAbierto,
  ] = useState(false)

  const [
    mostrarClave,
    setMostrarClave,
  ] = useState(false)

  const [
    moduloActivo,
    setModuloActivo,
  ] = useState('')


  // ===================================================
  // ROL Y MENÚ ACTUAL
  // ===================================================

  const rolActual =
    perfil?.roles ?? null

  const menu =
    rolActual
      ? menusByRole[
          rolActual.codigo as RoleCode
        ] ?? []
      : []

  const moduloSeleccionado =
    menu.find(
      item =>
        item.id ===
        moduloActivo,
    ) ?? menu[0]


  // ===================================================
  // AGRUPACIÓN DE PANTALLAS
  // ===================================================

  const modulosInventario = [
    'inventario',
    'inventario-consulta',
  ]

  const modulosProductos = [
    'productos',
    'productos-consulta',
  ]

  const modulosProveedores = [
    'proveedores',
    'proveedores-consulta',
  ]

  const modulosCompras = [
    'compras',
    'compras-consulta',
  ]

  const mostrarInventario =
    moduloSeleccionado
      ? modulosInventario.includes(
          moduloSeleccionado.id,
        )
      : false

  const mostrarProductos =
    moduloSeleccionado
      ? modulosProductos.includes(
          moduloSeleccionado.id,
        )
      : false

  const mostrarProveedores =
    moduloSeleccionado
      ? modulosProveedores.includes(
          moduloSeleccionado.id,
        )
      : false

  const mostrarCompras =
    moduloSeleccionado
      ? modulosCompras.includes(
          moduloSeleccionado.id,
        )
      : false


  // ===================================================
  // RECUPERAR SESIÓN
  // ===================================================

  useEffect(() => {
    async function obtenerSesionInicial() {
      const {
        data: { session },
      } =
        await supabase.auth
          .getSession()

      setUserId(
        session?.user.id ??
          null,
      )

      if (!session) {
        setCargando(false)
      }
    }

    void obtenerSesionInicial()

    const {
      data: { subscription },
    } =
      supabase.auth
        .onAuthStateChange(
          (_event, session) => {
            setUserId(
              session?.user.id ??
                null,
            )

            if (!session) {
              setPerfil(null)
              setModuloActivo('')
              setCargando(false)
            }
          },
        )

    return () => {
      subscription.unsubscribe()
    }
  }, [])


  // ===================================================
  // CARGAR PERFIL Y ROL
  // ===================================================

  useEffect(() => {
    if (!userId) {
      return
    }

    async function cargarPerfil() {
      setCargando(true)

      const {
        data,
        error,
      } =
        await supabase
          .from('profiles')
          .select(`
            id,
            nombre_completo,
            activo,
            roles (
              codigo,
              nombre
            )
          `)
          .eq(
            'id',
            userId,
          )
          .single()

      if (error) {
        setMensaje(
          `Error al leer el perfil: ${error.message}`,
        )

        setPerfil(null)
        setCargando(false)

        return
      }

      const respuesta =
        data as unknown as PerfilRespuesta

      const perfilData: Perfil = {
        id: respuesta.id,

        nombre_completo:
          respuesta.nombre_completo,

        activo:
          respuesta.activo,

        roles:
          obtenerRol(
            respuesta.roles,
          ),
      }

      if (!perfilData.activo) {
        await supabase.auth.signOut()

        setPerfil(null)
        setUserId(null)

        setMensaje(
          'Este usuario se encuentra inactivo.',
        )

        setCargando(false)

        return
      }

      if (!perfilData.roles) {
        await supabase.auth.signOut()

        setPerfil(null)
        setUserId(null)

        setMensaje(
          'Este usuario no tiene un rol asignado.',
        )

        setCargando(false)

        return
      }

      setPerfil(perfilData)
      setMensaje('')
      setCargando(false)
    }

    void cargarPerfil()
  }, [userId])


  // ===================================================
  // INICIAR SESIÓN
  // ===================================================

  async function iniciarSesion(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    setMensaje('')
    setCargando(true)

    const {
      data,
      error,
    } =
      await supabase.auth
        .signInWithPassword({
          email,
          password,
        })

    if (error) {
      setMensaje(
        'Correo o contraseña incorrectos.',
      )

      setCargando(false)

      return
    }

    setUserId(
      data.user.id,
    )

    setPassword('')
  }


  // ===================================================
  // CERRAR SESIÓN
  // ===================================================

  async function cerrarSesion() {
    const { error } =
      await supabase.auth
        .signOut()

    if (error) {
      setMensaje(
        `Error al cerrar sesión: ${error.message}`,
      )

      return
    }

    setPerfil(null)
    setUserId(null)

    setEmail('')
    setPassword('')
    setModuloActivo('')
    setMensaje('')
  }


  // ===================================================
  // RENDERIZAR MÓDULO ACTUAL
  // ===================================================

  function renderModulo() {
    if (!moduloSeleccionado) {
      return null
    }


    // -------------------------------------------------
    // INVENTARIO
    // -------------------------------------------------

    if (mostrarInventario) {
      return (
        <InventoryModule />
      )
    }


    // -------------------------------------------------
    // PRODUCTOS
    // -------------------------------------------------

    if (mostrarProductos) {
      return (
        <ProductsModule />
      )
    }


    // -------------------------------------------------
    // MOVIMIENTOS
    // -------------------------------------------------

    if (
      moduloSeleccionado.id ===
      'movimientos'
    ) {
      return (
        <MovementsModule />
      )
    }


    // -------------------------------------------------
    // REPOSICIÓN
    // -------------------------------------------------

    if (
      moduloSeleccionado.id ===
      'reposicion'
    ) {
      return (
        <ReplenishmentModule />
      )
    }


    // -------------------------------------------------
    // VENTAS
    // -------------------------------------------------

    if (
      moduloSeleccionado.id ===
      'ventas'
    ) {
      return (
        <SalesModule />
      )
    }


    // -------------------------------------------------
    // CAJA
    // -------------------------------------------------

    if (
      moduloSeleccionado.id ===
      'caja'
    ) {
      return (
        <CashModule />
      )
    }


    // -------------------------------------------------
    // COMPRAS
    // -------------------------------------------------

    if (mostrarCompras) {
      return (
        <PurchasesModule
          roleCode={
            rolActual?.codigo ??
            ''
          }
        />
      )
    }


    // -------------------------------------------------
    // RECEPCIÓN DE PRODUCTOS
    // -------------------------------------------------

    if (
      moduloSeleccionado.id ===
      'recepciones'
    ) {
      return (
        <PurchaseReceptionModule />
      )
    }


    // -------------------------------------------------
    // DEVOLUCIONES DE COMPRA
    // -------------------------------------------------

    if (
      moduloSeleccionado.id ===
      'devoluciones'
    ) {
      return (
        <PurchaseReturnsModule />
      )
    }


    // -------------------------------------------------
    // PROVEEDORES
    // -------------------------------------------------

    if (mostrarProveedores) {
      return (
        <SuppliersModule />
      )
    }


    // -------------------------------------------------
    // DASHBOARD
    // -------------------------------------------------

    if (
      moduloSeleccionado.id ===
      'dashboard'
    ) {
      const accesos =
        menu
          .filter(
            item =>
              item.id !==
              'dashboard',
          )
          .slice(0, 6)

      const principal =
        accesos.find(
          item =>
            item.id ===
            'ventas',
        ) ??
        accesos[0]

      return (
        <div className="dashboard">
          <section className="dashboard-hero">
            <div className="dashboard-hero-content">
              <span className="dashboard-kicker">
                <span />
                {' '}
                CASA HOGAR · PANEL DE CONTROL
              </span>

              <h2>
                Todo tu trabajo,
                <br />
                <em>
                  en un solo lugar.
                </em>
              </h2>

              <p>
                Accede a las áreas disponibles para tu perfil y continúa con las tareas del día.
              </p>

              {principal && (
                <button
                  type="button"
                  className="dashboard-action"
                  onClick={() =>
                    setModuloActivo(
                      principal.id,
                    )
                  }
                >
                  Abrir{' '}
                  {principal.nombre}{' '}
                  <span aria-hidden="true">
                    ↗
                  </span>
                </button>
              )}
            </div>

            <div
              className="hero-graphic"
              aria-hidden="true"
            >
              <div className="hero-graphic-orbit hero-graphic-orbit--outer" />

              <div className="hero-graphic-orbit hero-graphic-orbit--inner" />

              <div className="hero-graphic-center">
                CH
                <span>
                  ◆
                </span>
              </div>

              <span className="hero-graphic-point hero-graphic-point--one" />

              <span className="hero-graphic-point hero-graphic-point--two" />
            </div>
          </section>

          <div className="dashboard-heading">
            <div>
              <span className="section-kicker">
                TU ESPACIO DE TRABAJO
              </span>

              <h2>
                Accesos rápidos
              </h2>

              <p>
                Selecciona el área que necesitas para continuar.
              </p>
            </div>

            <span className="dashboard-count">
              {accesos.length}{' '}
              áreas disponibles
            </span>
          </div>

          <div className="dashboard-layout">
            <div className="dashboard-links">
              {accesos.map(
                (
                  item,
                  index,
                ) => (
                  <button
                    className="dashboard-link"
                    type="button"
                    key={
                      item.id
                    }
                    onClick={() =>
                      setModuloActivo(
                        item.id,
                      )
                    }
                  >
                    <span
                      className={`dashboard-link-icon dashboard-link-icon--${index % 4}`}
                    >
                      {getMenuIcon(
                        item.id,
                      )}
                    </span>

                    <span className="dashboard-link-copy">
                      <strong>
                        {item.nombre}
                      </strong>

                      <small>
                        Ir al módulo
                      </small>
                    </span>

                    <span
                      className="dashboard-link-arrow"
                      aria-hidden="true"
                    >
                      ↗
                    </span>
                  </button>
                ),
              )}
            </div>

            <aside className="dashboard-profile">
              <span className="section-kicker">
                SESIÓN ACTIVA
              </span>

              <div className="dashboard-profile-avatar">
                {perfil
                  ?.nombre_completo
                  ?.charAt(0)
                  .toUpperCase() ??
                  'U'}
              </div>

              <h3>
                {perfil
                  ?.nombre_completo ??
                  'Usuario'}
              </h3>

              <p>
                {rolActual?.nombre}
              </p>

              <div className="dashboard-profile-rule" />

              <div className="dashboard-profile-detail">
                <span>
                  Perfil
                </span>

                <strong>
                  {rolActual?.nombre}
                </strong>
              </div>

              <div className="dashboard-profile-detail">
                <span>
                  Estado
                </span>

                <strong className="dashboard-profile-active">
                  <i />
                  {' '}
                  Activo
                </strong>
              </div>
            </aside>
          </div>
        </div>
      )
    }


    // -------------------------------------------------
    // MÓDULO TODAVÍA NO IMPLEMENTADO
    // -------------------------------------------------

    return (
      <>
        <section className="grid">
          <article className="card">
            <div className="card-eyebrow">
              Módulo activo
            </div>

            <div className="card-module">
              <div className="card-icon">
                {getMenuIcon(
                  moduloSeleccionado.id,
                )}
              </div>

              <div>
                <h2 className="card-module-name">
                  {
                    moduloSeleccionado.nombre
                  }
                </h2>

                <p className="card-module-desc">
                  Habilitado para el perfil de{' '}
                  <strong>
                    {rolActual?.nombre}
                  </strong>
                  . Las funciones se incorporarán conforme avance el desarrollo.
                </p>
              </div>
            </div>

            <div className="card-stats">
              <div>
                <span className="stat-label">
                  Acceso
                </span>

                <strong className="stat-value stat-value--ok">
                  Autorizado
                </strong>
              </div>

              <div>
                <span className="stat-label">
                  Estado
                </span>

                <strong className="stat-value">
                  Preparado
                </strong>
              </div>
            </div>
          </article>

          <article className="card card--side">
            <div className="card-eyebrow">
              Módulos disponibles
            </div>

            <div className="card-count">
              {menu.length}
            </div>

            <div className="mod-list">
              {menu.map(
                item => (
                  <div
                    key={
                      item.id
                    }
                    className="mod-item"
                  >
                    <span className="mod-icon">
                      {getMenuIcon(
                        item.id,
                      )}
                    </span>

                    <span>
                      {item.nombre}
                    </span>
                  </div>
                ),
              )}
            </div>
          </article>
        </section>

        <section className="workspace">
          <div className="workspace-head">
            <h2 className="workspace-title">
              {
                moduloSeleccionado.nombre
              }
            </h2>

            <span className="workspace-tag">
              Preparado
            </span>
          </div>

          <div className="workspace-body">
            <div className="workspace-icon">
              {getMenuIcon(
                moduloSeleccionado.id,
              )}
            </div>

            <div>
              <h3 className="workspace-h3">
                Módulo listo para desarrollo
              </h3>

              <p className="workspace-p">
                Aquí se integrarán las funciones de{' '}
                <strong>
                  {
                    moduloSeleccionado.nombre
                  }
                </strong>{' '}
                cuando corresponda dentro del plan de desarrollo.
              </p>
            </div>
          </div>
        </section>
      </>
    )
  }


  // ===================================================
  // PANTALLA DE CARGA
  // ===================================================

  if (cargando) {
    return (
      <div className="splash">
        <div className="splash-mark">
          CH
        </div>

        <div className="splash-ring" />

        <p className="splash-text">
          Cargando sistema...
        </p>
      </div>
    )
  }


  // ===================================================
  // LOGIN
  // ===================================================

  if (
    !perfil ||
    !rolActual
  ) {
    return (
      <div className="auth-page">
        <div className="auth-showcase">
          <div className="auth-showcase-brand">
            <span className="showcase-mark">
              CH
              <span>
                ◆
              </span>
            </span>

            <strong>
              CASA HOGAR
            </strong>
          </div>

          <div className="auth-showcase-copy">
            <span className="auth-showcase-eyebrow">
              SISTEMA DE GESTIÓN
            </span>

            <h1>
              Un espacio para
              <br />
              hacer que todo{' '}
              <em>
                funcione mejor.
              </em>
            </h1>

            <p>
              Ventas, inventario y operaciones conectadas en una experiencia clara para cada equipo.
            </p>
          </div>

          <span className="auth-showcase-bottom">
            Organiza · Gestiona · Crece
          </span>

          <div className="auth-showcase-shape auth-showcase-shape--one" />

          <div className="auth-showcase-shape auth-showcase-shape--two" />
        </div>

        <div className="auth-form-side">
          <div className="auth-card">
            <div className="auth-header">
              <div className="auth-mark">
                CH
              </div>

              <div>
                <div className="auth-system">
                  Casa Hogar
                </div>

                <h2 className="auth-title">
                  Bienvenido de nuevo
                </h2>
              </div>
            </div>

            <p className="auth-subtitle">
              Ingresa con tus credenciales para continuar con tu trabajo.
            </p>

            <form
              className="auth-form"
              onSubmit={
                iniciarSesion
              }
            >
              <div className="field">
                <label htmlFor="email">
                  Correo electrónico
                </label>

                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={
                    event =>
                      setEmail(
                        event.target.value,
                      )
                  }
                  placeholder="tu@correo.com"
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="password">
                  Contraseña
                </label>

                <input
                  id="password"
                  type={
                    mostrarClave
                      ? 'text'
                      : 'password'
                  }
                  autoComplete="current-password"
                  value={password}
                  onChange={
                    event =>
                      setPassword(
                        event.target.value,
                      )
                  }
                  placeholder="••••••••"
                  required
                />

                <button
                  className="password-toggle"
                  type="button"
                  onClick={() =>
                    setMostrarClave(
                      !mostrarClave,
                    )
                  }
                  aria-label={
                    mostrarClave
                      ? 'Ocultar contraseña'
                      : 'Mostrar contraseña'
                  }
                >
                  {mostrarClave
                    ? 'Ocultar'
                    : 'Mostrar'}
                </button>
              </div>

              {mensaje && (
                <div className="auth-error">
                  {mensaje}
                </div>
              )}

              <button
                type="submit"
                className="auth-btn"
              >
                Ingresar al sistema{' '}
                <span aria-hidden="true">
                  →
                </span>
              </button>
            </form>

            <p className="auth-note">
              Acceso exclusivo para personal autorizado
            </p>
          </div>
        </div>
      </div>
    )
  }


  // ===================================================
  // SISTEMA PRINCIPAL
  // ===================================================

  return (
    <div className="shell">
      {menuAbierto && (
        <button
          className="nav-backdrop"
          type="button"
          aria-label="Cerrar menú"
          onClick={() =>
            setMenuAbierto(false)
          }
        />
      )}

      <aside
        className={`nav ${
          menuAbierto
            ? 'nav--open'
            : ''
        }`}
      >
        <div className="nav-brand">
          <div className="nav-mark">
            CH
            <span>
              ◆
            </span>
          </div>

          <div>
            <span className="nav-name">
              Casa Hogar
            </span>

            <span className="nav-sub">
              Sistema de Gestión
            </span>
          </div>
        </div>

        <span className="nav-section-label">
          MENÚ PRINCIPAL
        </span>

        <nav
          className="nav-menu"
          aria-label="Menú principal"
        >
          {menu.map(
            item => {
              const activo =
                moduloSeleccionado
                  ?.id ===
                item.id

              return (
                <button
                  key={
                    item.id
                  }
                  type="button"
                  className={
                    activo
                      ? 'nav-item nav-item--on'
                      : 'nav-item'
                  }
                  onClick={() => {
                    setModuloActivo(
                      item.id,
                    )

                    setMenuAbierto(
                      false,
                    )
                  }}
                  aria-current={
                    activo
                      ? 'page'
                      : undefined
                  }
                >
                  <span className="nav-icon">
                    {getMenuIcon(
                      item.id,
                    )}
                  </span>

                  <span>
                    {item.nombre}
                  </span>
                </button>
              )
            },
          )}
        </nav>

        <div className="nav-foot">
          <div className="nav-user">
            <div className="nav-avatar">
              {perfil
                .nombre_completo
                ?.charAt(0)
                .toUpperCase() ??
                'U'}
            </div>

            <div className="nav-user-info">
              <strong>
                {perfil
                  .nombre_completo ??
                  'Usuario'}
              </strong>

              <span>
                {
                  rolActual.nombre
                }
              </span>
            </div>
          </div>

          <button
            type="button"
            className="nav-signout"
            onClick={() => {
              setMenuAbierto(false)
              void cerrarSesion()
            }}
          >
            <span aria-hidden="true">
              ↪
            </span>
            {' '}
            Cerrar sesión
          </button>
        </div>
      </aside>


      <section className="content">
        <header className="bar">
          <button
            className="menu-toggle"
            type="button"
            onClick={() =>
              setMenuAbierto(true)
            }
            aria-label="Abrir menú"
            aria-expanded={
              menuAbierto
            }
          >
            <span />
            <span />
            <span />
          </button>

          <div className="bar-path">
            <span>
              Casa Hogar
            </span>

            <span className="bar-sep">
              /
            </span>

            <strong>
              {moduloSeleccionado
                ?.nombre ??
                'Inicio'}
            </strong>
          </div>

          <div className="bar-user">
            <div className="bar-dot" />

            <div className="bar-user-text">
              <strong>
                {perfil
                  .nombre_completo ??
                  'Usuario'}
              </strong>

              <span>
                {
                  rolActual.nombre
                }
              </span>
            </div>

            <div className="bar-avatar">
              {perfil
                .nombre_completo
                ?.charAt(0)
                .toUpperCase() ??
                'U'}
            </div>
          </div>
        </header>


        <main className="body">
          <div className="body-head">
            <div>
              <span className="body-eyebrow">
                CASA HOGAR /{' '}
                {rolActual.nombre.toUpperCase()}
              </span>

              <h1 className="body-title">
                {moduloSeleccionado
                  ?.id ===
                'dashboard'
                  ? 'Panel principal'
                  : moduloSeleccionado
                      ?.nombre ??
                    'Inicio'}
              </h1>

              <p className="body-desc">
                {moduloSeleccionado
                  ?.id ===
                'dashboard'
                  ? 'Bienvenido a tu espacio de trabajo.'
                  : `Gestiona ${
                      moduloSeleccionado
                        ?.nombre
                        .toLowerCase() ??
                      'tu área'
                    } desde aquí.`}
              </p>
            </div>

            <div className="body-badge">
              <span className="badge-dot" />
              Acceso autorizado
            </div>
          </div>

          {renderModulo()}
        </main>
      </section>
    </div>
  )
}

export default App