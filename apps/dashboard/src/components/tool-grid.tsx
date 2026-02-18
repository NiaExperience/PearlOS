import ToolCard from './tool-card';

const tools = [
  {
    id: 1,
    name: 'Spa Service Booking',
    description:
      'Book a relaxing spa treatment at your preferred location and time.',
    image: '/placeholder.svg?height=200&width=200',
    category: 'Productivity',
  },
  {
    id: 2,
    name: 'Food Ordering',
    description:
      'Order food from your favorite restaurants with customized preferences.',
    image: '/placeholder.svg?height=200&width=200',
    category: 'Entertainment',
  },
  {
    id: 3,
    name: 'Weather Forecast',
    description:
      'Get accurate weather forecasts for any location and time period.',
    image: '/placeholder.svg?height=200&width=200',
    category: 'Productivity',
  },
  {
    id: 4,
    name: 'Email Composition',
    description:
      'Compose and send emails with AI-assisted writing and formatting.',
    image: '/placeholder.svg?height=200&width=200',
    category: 'Communication',
  },
  {
    id: 5,
    name: 'Smart Home Control',
    description:
      'Control your smart home devices with voice commands or text instructions.',
    image: '/placeholder.svg?height=200&width=200',
    category: 'Home Automation',
  },
  {
    id: 6,
    name: 'Travel Planning',
    description:
      'Plan your trips with personalized itineraries and booking assistance.',
    image: '/placeholder.svg?height=200&width=200',
    category: 'Travel',
  },
];

export default function ToolGrid() {
  return (
    <div className='grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6'>
      {tools.map((tool) => (
        <ToolCard key={tool.id} {...tool} />
      ))}
    </div>
  );
}
