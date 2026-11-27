import React from 'react';
import { BarChart3 } from 'lucide-react';
import RoadmapPlaceholder from './RoadmapPlaceholder';

const AssetManagement = () => (
    <RoadmapPlaceholder
        title="Asset Management"
        subtitle="Portfolio-Überblick und Vermögensverwaltung."
        icon={BarChart3}
        hint="Den Portfolio-Überblick mit Marktwerten, Darlehen und Renditen bietet bereits das Cockpit im Investor-Portal."
        linkTo="/investor-portal?tab=cockpit"
        linkLabel="Zum Cockpit"
    />
);

export default AssetManagement;
