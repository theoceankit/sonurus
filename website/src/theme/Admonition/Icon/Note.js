import React from 'react';
import AppIcon from '@site/src/components/AppIcon';
import Svg from '@site/../ui/src/assets/icons/info.svg';

// The app's info icon in place of Docusaurus' own.
export default function AdmonitionIconNote({className}) {
  return <AppIcon svg={Svg} size={16} className={className} />;
}
