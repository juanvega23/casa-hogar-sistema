import { useState } from 'react'
import { supabase } from './lib/supabase'

function App() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [perfil, setPerfil] = useState<any>(null)

  async function iniciarSesion(event: React.FormEvent) {
    event.preventDefault()

    setMensaje('Iniciando sesión...')
    setPerfil(null)

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setMensaje(`Error: ${error.message}`)
      return
    }

    const user = data.user

    const { data: perfilData, error: perfilError } = await supabase
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
      .eq('id', user.id)
      .single()

    if (perfilError) {
      setMensaje(`Sesión iniciada, pero ocurrió un error al leer el perfil: ${perfilError.message}`)
      return
    }

    setPerfil(perfilData)
    setMensaje('✅ Inicio de sesión correcto')
  }

  async function cerrarSesion() {
    await supabase.auth.signOut()
    setPerfil(null)
    setMensaje('Sesión cerrada')
  }

  return (
    <main style={{ padding: '40px', fontFamily: 'Arial', maxWidth: '500px', margin: 'auto' }}>
      <h1>Casa Hogar Sistema</h1>

      {!perfil ? (
        <form onSubmit={iniciarSesion}>
          <div style={{ marginBottom: '15px' }}>
            <label>Correo</label>
            <br />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ width: '100%', padding: '10px' }}
            />
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label>Contraseña</label>
            <br />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ width: '100%', padding: '10px' }}
            />
          </div>

          <button type="submit">
            Iniciar sesión
          </button>
        </form>
      ) : (
        <section>
          <h2>Usuario autenticado</h2>

          <p>
            <strong>Nombre:</strong> {perfil.nombre_completo}
          </p>

          <p>
            <strong>Rol:</strong> {perfil.roles?.nombre}
          </p>

          <p>
            <strong>Código del rol:</strong> {perfil.roles?.codigo}
          </p>

          <p>
            <strong>Estado:</strong> {perfil.activo ? 'Activo' : 'Inactivo'}
          </p>

          <button onClick={cerrarSesion}>
            Cerrar sesión
          </button>
        </section>
      )}

      <p>{mensaje}</p>
    </main>
  )
}

export default App