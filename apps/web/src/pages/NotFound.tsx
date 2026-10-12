import { Link } from 'react-router';
import { Button, Empty } from '../ui';

export function NotFound() {
  return <Empty title="This page doesn't exist" action={<Link to="/"><Button>Back to projects</Button></Link>} />;
}
