import { ShowTokenUsageOutPort } from '../../application/ports/out/tokenUsageOutPort';
import { TokenUsageReport } from '../../domain/tokenUsage';

interface TableColumn {
    header: string;
    align: 'left' | 'right';
}

type TableRow = Record<string, string>;

const COLUMNS: TableColumn[] = [
    { header: 'Period', align: 'left' },
    { header: 'Agent', align: 'left' },
    { header: 'Model', align: 'left' },
    { header: 'Input', align: 'right' },
    { header: 'Output', align: 'right' },
    { header: 'Cached', align: 'right' },
    { header: 'Total', align: 'right' },
    { header: 'Cost', align: 'right' }
];

export class ConsoleTokenUsagePresenter implements ShowTokenUsageOutPort {
    constructor(private writeLine: (line: string) => void = console.log) {}

    showTokenUsage(report: TokenUsageReport): void {
        this.writeLine(`Token Usage (${report.period}: ${report.startDate} - ${report.endDate})`);

        if (report.entries.length === 0) {
            this.writeLine('No token usage found.');
            return;
        }

        this.writeLine(renderTable(report));
    }
}

function renderTable(report: TokenUsageReport): string {
    const rows: TableRow[] = report.entries.map((entry) => ({
        Period: entry.date,
        Agent: entry.agent,
        Model: entry.model,
        Input: formatNumber(entry.inputTokens),
        Output: formatNumber(entry.outputTokens),
        Cached: formatNumber(entry.cachedTokens),
        Total: formatNumber(entry.totalTokens),
        Cost: formatCost(entry.cost)
    }));

    rows.push({
        Period: 'Total',
        Agent: '',
        Model: '',
        Input: formatNumber(report.total.inputTokens),
        Output: formatNumber(report.total.outputTokens),
        Cached: formatNumber(report.total.cachedTokens),
        Total: formatNumber(report.total.totalTokens),
        Cost: formatCost(report.total.cost)
    });

    const widths = COLUMNS.map((column) => Math.max(column.header.length, ...rows.map((row) => row[column.header].length)));
    const separator = widths.map((width) => '-'.repeat(width)).join('-+-');
    const header = COLUMNS.map((column, index) => pad(column.header, widths[index], column.align)).join(' | ');
    const body = rows.map((row) => COLUMNS.map((column, index) => pad(row[column.header], widths[index], column.align)).join(' | '));

    return [header, separator, ...body].join('\n');
}

function formatNumber(value: number): string {
    return new Intl.NumberFormat('en-US').format(value);
}

function formatCost(value: number): string {
    return value.toFixed(2);
}

function pad(value: string, width: number, align: 'left' | 'right'): string {
    if (align === 'right') {
        return value.padStart(width);
    }

    return value.padEnd(width);
}
