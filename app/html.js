function create(type, props, ...children) {
  if (props && props.class != null) {
    props = Object.assign({}, props, { className: props.class });
    delete props.class;
  }
  return React.createElement(type, props, ...children);
}

export const html = window.htm.bind(create);
