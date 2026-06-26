import { describe, expect, it } from 'vitest'
import { useDeploymentSelection } from './deployments'

describe('deployment selection store', () => {
  it('keeps the selected deployment id trimmed', () => {
    useDeploymentSelection.setState({ selectedDeploymentID: '' })

    useDeploymentSelection.getState().setSelectedDeploymentID(' deployment_1 ')

    expect(useDeploymentSelection.getState().selectedDeploymentID).toBe('deployment_1')
  })
})
