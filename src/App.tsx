import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { menusByRole, type RoleCode } from './config/roleMenus'

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

function obtenerRol(roles: Rol | Rol[] | null): Rol | null {
  if (!roles) {
    return null
  }

  if (Array.isArray(roles)) {
    return roles[0] ?? null
  }

  return roles
}

function App() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  const rolActual = perfil?.roles ?? null

  const menu = rolActual
    ? menusByRole[rolActual.codigo as RoleCode] ?? []
    : []

  // =====================================================
  // 1. RECUPERAR SESIÓN AL ABRIR LA APLICACIÓN
  // =====================================================

  useEffect(() => {
    async function obtenerSesionInicial() {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      setUserId(session?.user.id ?? null)

      if (!session) {
        setCargando(false)
      }
    }

    obtenerSesionInicial()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null)

      if (!session) {
        setPerfil(null)
        setCargando(false)
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  // =====================================================
  // 2. CARGAR PERFIL Y ROL
  // =====================================================

  useEffect(() => {
    if (!userId) {
      return
    }

    async function cargarPerfil() {
      setCargando(true)

      const { data, error } = await supabase
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
          `Error al leer el perfil: ${error.message}`
        )
        setPerfil(null)
        setCargando(false)
        return
      }

      const respuesta =
        data as unknown as PerfilRespuesta

      const perfilData: Perfil = {
        id: respuesta.id,
        nombre_completo: respuesta.nombre_completo,
        activo: respuesta.activo,
        roles: obtenerRol(respuesta.roles),
      }

      // Usuario inactivo
      if (!perfilData.activo) {
        await supabase.auth.signOut()

        setPerfil(null)
        setUserId(null)
        setMensaje(
          '⛔ Este usuario se encuentra inactivo.'
        )
        setCargando(false)

        return
      }

      // Usuario sin rol
      if (!perfilData.roles) {
        await supabase.auth.signOut()

        setPerfil(null)
        setUserId(null)
        setMensaje(
          '⛔ Este usuario no tiene un rol asignado.'
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
  // 3. INICIAR SESIÓN
  // =====================================================

  async function iniciarSesion(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault()

    setMensaje('Iniciando sesión...')
    setCargando(true)

    const { data, error } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      })

    if (error) {
      setMensaje(`Error: ${error.message}`)
      setCargando(false)
      return
    }

    setUserId(data.user.id)
    setPassword('')
  }

  // =====================================================
  // 4. CERRAR SESIÓN
  // =====================================================

  async function cerrarSesion() {
    const { error } = await supabase.auth.signOut()

    if (error) {
      setMensaje(
        `Error al cerrar sesión: ${error.message}`
      )
      return
    }

    setPerfil(null)
    setUserId(null)
    setEmail('')
    setPassword('')
    setMensaje('Sesión cerrada correctamente.')
  }

  // =====================================================
  // 5. PANTALLA DE CARGA
  // =====================================================

  if (cargando) {
    return (
      <main
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        <section style={{ textAlign: 'center' }}>
          <h1>Casa Hogar Sistema</h1>
          <p>Cargando sesión...</p>
        </section>
      </main>
    )
  }

  // =====================================================
  // 6. LOGIN
  // =====================================================

  if (!perfil || !rolActual) {
    return (
      <main
        style={{
          minHeight: '100vh',
          fontFamily: 'Arial, sans-serif',
          backgroundColor: '#f5f5f5',
        }}
      >
        <section
          style={{
            maxWidth: '420px',
            margin: '0 auto',
            paddingTop: '100px',
          }}
        >
          <div
            style={{
              backgroundColor: 'white',
              padding: '30px',
              borderRadius: '10px',
              boxShadow:
                '0 2px 10px rgba(0,0,0,0.1)',
            }}
          >
            <h1
              style={{
                textAlign: 'center',
                marginBottom: '10px',
              }}
            >
              Casa Hogar Sistema
            </h1>

            <p
              style={{
                textAlign: 'center',
                marginBottom: '25px',
                color: '#555',
              }}
            >
              Iniciar sesión
            </p>

            <form onSubmit={iniciarSesion}>
              <div
                style={{
                  marginBottom: '15px',
                }}
              >
                <label
                  htmlFor="email"
                  style={{
                    display: 'block',
                    marginBottom: '5px',
                  }}
                >
                  Correo
                </label>

                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) =>
                    setEmail(event.target.value)
                  }
                  required
                  style={{
                    width: '100%',
                    padding: '10px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div
                style={{
                  marginBottom: '20px',
                }}
              >
                <label
                  htmlFor="password"
                  style={{
                    display: 'block',
                    marginBottom: '5px',
                  }}
                >
                  Contraseña
                </label>

                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) =>
                    setPassword(event.target.value)
                  }
                  required
                  style={{
                    width: '100%',
                    padding: '10px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <button
                type="submit"
                style={{
                  width: '100%',
                  padding: '10px',
                  cursor: 'pointer',
                }}
              >
                Iniciar sesión
              </button>
            </form>

            {mensaje && (
              <p
                style={{
                  marginTop: '20px',
                  textAlign: 'center',
                }}
              >
                {mensaje}
              </p>
            )}
          </div>
        </section>
      </main>
    )
  }

  // =====================================================
  // 7. INTERFAZ DEL USUARIO AUTENTICADO
  // =====================================================

  return (
    <main
      style={{
        minHeight: '100vh',
        fontFamily: 'Arial, sans-serif',
        backgroundColor: '#f5f5f5',
      }}
    >
      <div
        style={{
          display: 'flex',
          minHeight: '100vh',
        }}
      >
        {/* ============================================= */}
        {/* MENÚ LATERAL */}
        {/* ============================================= */}

        <aside
          style={{
            width: '250px',
            backgroundColor: '#ffffff',
            borderRight: '1px solid #ddd',
            padding: '25px',
            boxSizing: 'border-box',
          }}
        >
          <h2
            style={{
              marginTop: 0,
            }}
          >
            Casa Hogar
          </h2>

          <p
            style={{
              color: '#555',
              fontSize: '14px',
            }}
          >
            {rolActual.nombre}
          </p>

          <hr />

          <h3>Módulos</h3>

          <nav>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
              }}
            >
              {menu.map((item) => (
                <li
                  key={item.id}
                  style={{
                    marginBottom: '10px',
                  }}
                >
                  <button
                    type="button"
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px',
                      cursor: 'pointer',
                      border: '1px solid #ddd',
                      backgroundColor: '#fafafa',
                      borderRadius: '5px',
                    }}
                  >
                    {item.nombre}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <hr />

          <button
            type="button"
            onClick={cerrarSesion}
            style={{
              width: '100%',
              padding: '10px',
              cursor: 'pointer',
              marginTop: '15px',
            }}
          >
            Cerrar sesión
          </button>
        </aside>

        {/* ============================================= */}
        {/* CONTENIDO PRINCIPAL */}
        {/* ============================================= */}

        <section
          style={{
            flex: 1,
            padding: '40px',
          }}
        >
          <h1>
            Bienvenido a Casa Hogar Sistema
          </h1>

          <div
            style={{
              backgroundColor: 'white',
              padding: '25px',
              borderRadius: '10px',
              boxShadow:
                '0 2px 8px rgba(0,0,0,0.08)',
              maxWidth: '700px',
            }}
          >
            <h2>Información del usuario</h2>

            <p>
              <strong>Nombre:</strong>{' '}
              {perfil.nombre_completo}
            </p>

            <p>
              <strong>Rol:</strong>{' '}
              {rolActual.nombre}
            </p>

            <p>
              <strong>Código del rol:</strong>{' '}
              {rolActual.codigo}
            </p>

            <p>
              <strong>Estado:</strong>{' '}
              {perfil.activo
                ? 'Activo'
                : 'Inactivo'}
            </p>
          </div>

          <div
            style={{
              marginTop: '30px',
              backgroundColor: 'white',
              padding: '25px',
              borderRadius: '10px',
              boxShadow:
                '0 2px 8px rgba(0,0,0,0.08)',
              maxWidth: '700px',
            }}
          >
            <h2>Módulos disponibles</h2>

            <p>
              Según tu rol tienes acceso a:
            </p>

            <ul>
              {menu.map((item) => (
                <li key={item.id}>
                  {item.nombre}
                </li>
              ))}
            </ul>
          </div>

          {mensaje && (
            <p
              style={{
                marginTop: '20px',
              }}
            >
              {mensaje}
            </p>
          )}
        </section>
      </div>
    </main>
  )
}

export default App