// Business facts in one place. Every value marked `placeholder: true` is waiting on the owner.
export const site = {
  name: 'Moon and Silks Circus Co',
  url: 'https://www.moonandsilks.com',
  email: { value: 'hello@moonandsilks.com', placeholder: true },
  location: { value: '[placeholder: venue / suburb]', placeholder: true },
  socials: [
    { label: 'Instagram', href: '#', placeholder: true },
    { label: 'Facebook', href: '#', placeholder: true },
  ],
  nav: [
    { label: 'Home', href: '/' },
    { label: 'Book a class', href: '/book' },
    { label: 'About', href: '/about' },
    { label: 'Contact', href: '/contact' },
  ],
};
