import {createContext,useContext} from 'react';
import {QUALITY_PROFILES} from './sceneQuality.js';

export const SceneQualityContext = createContext(QUALITY_PROFILES.balanced);
export const SceneQualityProvider = SceneQualityContext.Provider;
export const useSceneQuality = () => useContext(SceneQualityContext);
