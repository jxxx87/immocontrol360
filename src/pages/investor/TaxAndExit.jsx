import React from 'react';
import { Receipt } from 'lucide-react';
import RoadmapPlaceholder from './RoadmapPlaceholder';

const TaxAndExit = () => (
    <RoadmapPlaceholder
        title="Steuer & Exit"
        subtitle="Steuerliche Aspekte und Exit-Strategien planen."
        icon={Receipt}
        hint="Eine vereinfachte Steuer-/AfA-Betrachtung gibt es bereits im Buy & Hold-Deal-Rechner des Investor-Portals."
        linkTo="/investor-portal?tab=deals"
        linkLabel="Zu den Deals"
    />
);

export default TaxAndExit;
