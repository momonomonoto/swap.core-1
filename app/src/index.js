import React from 'react'
import ReactDOM from 'react-dom'
import App from './App'
import { app } from './swap'


app.on('ready', () => {
  ReactDOM.render(<App />, document.getElementById('root'))
})
