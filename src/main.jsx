import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.jsx';

class PreviewBoundary extends React.Component {
  state={error:null};
  static getDerivedStateFromError(error){return {error};}
  render(){return this.state.error ? <main style={{padding:32,fontFamily:'Microsoft YaHei,sans-serif'}}><h1>3D 场景加载失败</h1><p>{this.state.error.message}</p><button onClick={()=>location.reload()}>重新加载</button></main> : this.props.children;}
}
createRoot(document.getElementById('root')).render(<PreviewBoundary><App/></PreviewBoundary>);

