import { useEffect, useState } from 'react';
import { getServices } from '../../api';
import type { ServiceStatus as ServiceStatusType } from '../../types';

export function ServiceStatus() {
  const [services, setServices] = useState<Record<string, ServiceStatusType>>({});

  useEffect(() => {
    const load = () => { getServices().then(setServices).catch(() => {}); };
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="services-bar">
      {Object.entries(services).map(([name, s]) => (
        <div key={name} className="service-badge">
          <span className={`dot ${s.healthy ? 'up' : 'down'}`} />
          {name.replace(/-/g, ' ')}
        </div>
      ))}
    </div>
  );
}
