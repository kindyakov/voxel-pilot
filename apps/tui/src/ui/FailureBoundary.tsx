import { Component, type ReactNode } from 'react'

interface Props {
	readonly children: ReactNode
	readonly fallback: ReactNode
	readonly onFailure?: () => void
}

export class FailureBoundary extends Component<Props, { failed: boolean }> {
	override state = { failed: false }
	static getDerivedStateFromError() {
		return { failed: true }
	}
	override componentDidCatch() {
		this.props.onFailure?.()
	}
	override render() {
		return this.state.failed ? this.props.fallback : this.props.children
	}
}
