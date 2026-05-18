import React from 'react';

const Table = ({ columns, data, onRowClick, getRowStyle }) => {
    return (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr>
                        {columns.map((col, index) => (
                            <th key={index} style={{
                                textAlign: col.align || 'left',
                                padding: 'var(--spacing-md)',
                                color: 'var(--text-secondary)',
                                borderBottom: '1px solid var(--border-color)',
                                fontSize: 'var(--font-size-sm)',
                                fontWeight: 600
                            }}>
                                {col.header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {data.map((row, rowIndex) => (
                        <tr
                            key={row.id || rowIndex}
                            className="table-row"
                            onClick={() => onRowClick && onRowClick(row)}
                            style={{
                                cursor: onRowClick ? 'pointer' : 'default',
                                ...(getRowStyle ? getRowStyle(row) : {})
                            }}
                        >
                            {columns.map((col, colIndex) => (
                                <td key={colIndex} style={{
                                    textAlign: col.align || 'left',
                                    padding: 'var(--spacing-md)',
                                    borderBottom: '1px solid var(--border-color)',
                                    color: 'var(--text-primary)'
                                }}>
                                    {col.render ? col.render(row) : row[col.accessor]}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default Table;
