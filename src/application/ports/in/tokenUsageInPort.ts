export interface ViewTokenUsageInPort {
    viewTokenUsage(command: ViewTokenUsageCommand): Promise<void>;
}

export interface ViewTokenUsageCommand {
    timePeriod: string;
}
