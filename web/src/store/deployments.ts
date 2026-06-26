import { create } from 'zustand'

type DeploymentSelectionState = {
  selectedDeploymentID: string
  setSelectedDeploymentID: (deploymentID: string) => void
}

export const useDeploymentSelection = create<DeploymentSelectionState>((set) => ({
  selectedDeploymentID: '',
  setSelectedDeploymentID: (deploymentID) => set({ selectedDeploymentID: deploymentID.trim() }),
}))
