import { App } from './App.js';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('UI Error:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const phone = String((window.SHOP && window.SHOP.phone) || '').replace(/\D/g, '');
    const children = [
      React.createElement('h2', null, 'Что-то пошло не так'),
      React.createElement('p', null, 'Нажмите обновить или напишите нам в WhatsApp.')
    ];
    if (phone) {
      children.push(React.createElement('p', null,
        React.createElement('a', { href: 'https://wa.me/' + phone }, 'Написать в WhatsApp')));
    }
    children.push(React.createElement('p', null,
      React.createElement('button', {
        type: 'button',
        onClick: function () { window.location.reload(); }
      }, 'Обновить')));
    return React.createElement('div', {
      style: { padding: '20px', textAlign: 'center', fontFamily: 'Onest, Segoe UI, sans-serif' }
    }, children);
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  React.createElement(ErrorBoundary, null, React.createElement(App))
);
