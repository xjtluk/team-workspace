import { render } from 'preact';
import { App } from './App.jsx';
import './styles/global.css';
import './styles/chat.css';
import './styles/status.css';

render(<App />, document.getElementById('app'));
