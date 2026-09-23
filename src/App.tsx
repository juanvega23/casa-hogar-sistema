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
import './App.css'

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
  const icons: Record<string, string> = {
    dashboard: '▦',
    reportes: '⌁',

    inventario: '□',
    'inventario-consulta': '□',

    productos: '◫',
    'productos-consulta': '⌕',

    movimientos: '⇄',
    reposicion: '↻',

    compras: '◇',
    'compras-consulta': '◇',

    proveedores: '○',
    'proveedores-consulta': '○',

    ventas: '▤',
    caja: '▣',

    alertas: '!',

    usuarios: '♙',
    roles: '◎',
    auditoria: '≡',
    configuracion: '⚙',
  }

  return icons[id] ?? '•'
}

function App() {
  const [email, setEmail] =
    useState('')

  const [password, setPassword] =
    useState('')

  const [mensaje, setMensaje] =
    useState('')

  const [perfil, setPerfil] =
    useState<Perfil | null>(null)

  const [userId, setUserId] =
    useState<string | null>(null)

  const [cargando, setCargando] =
    useState(true)

  const [
    moduloActivo,
    setModuloActivo,
  ] = useState('')

  const rolActual =
    perfil?.roles ?? null

  const menu = rolActual
    ? menusByRole[
        rolActual.codigo as RoleCode
      ] ?? []
    : []

  const moduloSeleccionado =
    menu.find(
      (item) =>
        item.id === moduloActivo,
    ) ?? menu[0]

  // =====================================================
  // IDENTIFICAR PANTALLAS REALES
  // =====================================================

  const modulosInventario = [
    'inventario',
    'inventario-consulta',
  ]

  const modulosProductos = [
    'productos',
    'productos-consulta',
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

  // =====================================================
  // SESIÓN
  // =====================================================

  useEffect(() => {
    async function obtenerSesionInicial() {
      const {
        data: { session },
      } =
        await supabase.auth.getSession()

      setUserId(
        session?.user.id ?? null,
      )

      if (!session) {
        setCargando(false)
      }
    }

    obtenerSesionInicial()

    const {
      data: { subscription },
    } =
      supabase.auth.onAuthStateChange(
        (_event, session) => {
          setUserId(
            session?.user.id ?? null,
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

  // =====================================================
  // PERFIL Y ROL
  // =====================================================

  useEffect(() => {
    if (!userId) {
      return
    }

    async function cargarPerfil() {
      setCargando(true)

      const { data, error } =
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
          .eq('id', userId)
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

    cargarPerfil()
  }, [userId])

  // =====================================================
  // PRIMER MÓDULO DEL ROL
  // =====================================================

  useEffect(() => {
    if (
      menu.length > 0 &&
      !moduloActivo
    ) {
      setModuloActivo(
        menu[0].id,
      )
    }
  }, [menu, moduloActivo])

  // =====================================================
  // LOGIN
  // =====================================================

  async function iniciarSesion(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    setMensaje('')
    setCargando(true)

    const { data, error } =
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

    setUserId(data.user.id)
    setPassword('')
  }

  // =====================================================
  // LOGOUT
  // =====================================================

  async function cerrarSesion() {
    const { error } =
      await supabase.auth.signOut()

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

  // =====================================================
  // CARGA
  // =====================================================

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

  // =====================================================
  // LOGIN
  // =====================================================

  if (!perfil || !rolActual) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-header">
            <div className="auth-mark">
              CH
            </div>

            <div>
              <div className="auth-system">
                Casa Hogar
              </div>

              <div className="auth-title">
                Sistema de Gestión
              </div>
            </div>
          </div>

          <p className="auth-subtitle">
            Ingresa tus credenciales
            para acceder al sistema.
          </p>

          <form
            className="auth-form"
            onSubmit={iniciarSesion}
          >
            <div className="field">
              <label htmlFor="email">
                Correo electrónico
              </label>

              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) =>
                  setEmail(
                    event.target.value,
                  )
                }
                placeholder="usuario@casahogar.test"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="password">
                Contraseña
              </label>

              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(
                    event.target.value,
                  )
                }
                placeholder="••••••••"
                required
              />
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
              Ingresar
            </button>
          </form>

          <p className="auth-note">
            Acceso exclusivo para
            personal autorizado
          </p>
        </div>
      </div>
    )
  }

  // =====================================================
  // SISTEMA
  // =====================================================

  return (
    <div className="shell">
      {/* =================================================
          SIDEBAR
      ================================================= */}

      <aside className="nav">
        <div className="nav-brand">
          <div className="nav-mark">
            C
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

        <nav className="nav-menu">
          {menu.map((item) => {
            const activo =
              moduloSeleccionado
                ?.id === item.id

            return (
              <button
                key={item.id}
                type="button"
                className={
                  activo
                    ? 'nav-item nav-item--on'
                    : 'nav-item'
                }
                onClick={() =>
                  setModuloActivo(
                    item.id,
                  )
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
          })}
        </nav>

        <div className="nav-foot">
          <div className="nav-user">
            <div className="nav-avatar">
              {perfil.nombre_completo
                ?.charAt(0)
                .toUpperCase() ??
                'U'}
            </div>

            <div className="nav-user-info">
              <strong>
                {perfil.nombre_completo ??
                  'Usuario'}
              </strong>

              <span>
                {rolActual.nombre}
              </span>
            </div>
          </div>

          <button
            type="button"
            className="nav-signout"
            onClick={cerrarSesion}
          >
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* =================================================
          ÁREA PRINCIPAL
      ================================================= */}

      <section className="content">
        {/* ===============================================
            TOPBAR
        =============================================== */}

        <header className="bar">
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
                {perfil.nombre_completo ??
                  'Usuario'}
              </strong>

              <span>
                {rolActual.nombre}
              </span>
            </div>

            <div className="bar-avatar">
              {perfil.nombre_completo
                ?.charAt(0)
                .toUpperCase() ??
                'U'}
            </div>
          </div>
        </header>

        {/* ===============================================
            CUERPO
        =============================================== */}

        <main className="body">
          <div className="body-head">
            <div>
              <h1 className="body-title">
                {moduloSeleccionado
                  ?.nombre ??
                  'Inicio'}
              </h1>

              <p className="body-desc">
                Panel de trabajo de{' '}
                {rolActual.nombre}.
              </p>
            </div>

            <div className="body-badge">
              <span className="badge-dot" />

              Acceso autorizado
            </div>
          </div>

          {/* =============================================
              INVENTARIO
          ============================================= */}

          {mostrarInventario ? (
              <InventoryModule />
            ) : mostrarProductos ? (
              <ProductsModule />
            ) : moduloSeleccionado?.id === 'movimientos' ? (
              <MovementsModule />
            ) : moduloSeleccionado?.id === 'reposicion' ? (
              <ReplenishmentModule />
            ) : moduloSeleccionado?.id === 'ventas' ? (
              <SalesModule />
            ) : moduloSeleccionado?.id === 'caja' ? (
              <CashModule />
            ) : (
            <>
              {/* =========================================
                  RESUMEN GENÉRICO
              ========================================= */}

              <section className="grid">
                <article className="card">
                  <div className="card-eyebrow">
                    Módulo activo
                  </div>

                  <div className="card-module">
                    <div className="card-icon">
                      {getMenuIcon(
                        moduloSeleccionado
                          ?.id ?? '',
                      )}
                    </div>

                    <div>
                      <h2 className="card-module-name">
                        {
                          moduloSeleccionado
                            ?.nombre
                        }
                      </h2>

                      <p className="card-module-desc">
                        Habilitado para
                        el perfil de{' '}
                        <strong>
                          {
                            rolActual.nombre
                          }
                        </strong>
                        . Las funciones se
                        incorporarán conforme
                        avance el desarrollo.
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
                    {menu.map((item) => (
                      <div
                        key={item.id}
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
                    ))}
                  </div>
                </article>
              </section>

              {/* =========================================
                  ÁREA GENÉRICA
              ========================================= */}

              <section className="workspace">
                <div className="workspace-head">
                  <h2 className="workspace-title">
                    {moduloSeleccionado
                      ?.nombre ??
                      'Módulo'}
                  </h2>

                  <span className="workspace-tag">
                    Preparado
                  </span>
                </div>

                <div className="workspace-body">
                  <div className="workspace-icon">
                    {getMenuIcon(
                      moduloSeleccionado
                        ?.id ?? '',
                    )}
                  </div>

                  <div>
                    <h3 className="workspace-h3">
                      Módulo listo para
                      desarrollo
                    </h3>

                    <p className="workspace-p">
                      Aquí se integrarán
                      las funciones de{' '}
                      <strong>
                        {moduloSeleccionado
                          ?.nombre ??
                          'este módulo'}
                      </strong>{' '}
                      cuando corresponda
                      dentro del plan de
                      desarrollo.
                    </p>
                  </div>
                </div>
              </section>
            </>
          )}
        </main>
      </section>
    </div>
  )
}

export default App