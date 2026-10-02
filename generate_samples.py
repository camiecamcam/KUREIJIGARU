from reportlab.pdfgen import canvas
from pathlib import Path

OUTPUT = Path(__file__).parent / 'demo-pdfs'
OUTPUT.mkdir(exist_ok=True)

samples = [
    {
        'filename': 'sample_01_applicant.pdf',
        'lines': [
            'Applicant: JUAN DELA CRUZ',
            'Address: 24 Mango Street, Quezon City',
            'Employee: MARY ANN REYES',
            'Date: 2026-10-01'
        ]
    },
    {
        'filename': 'sample_02_client.pdf',
        'lines': [
            'Client: MARIA SANTOS',
            'Owner: PEDRO SANTOS',
            'Witness: CARLOS REYES',
            'Beneficiary: ANA SANTOS'
        ]
    },
    {
        'filename': 'sample_03_patient.pdf',
        'lines': [
            'Patient: ROBERTO LIM',
            'Spouse: CRISTINE LIM',
            'Prepared by: JOSE DELA CRUZ'
        ]
    },
    {
        'filename': 'sample_04_owner.pdf',
        'lines': [
            'Owner: ANGELICA MENDOZA',
            'Father: JULIUS MENDOZA',
            'Mother: ROSALIE MENDOZA'
        ]
    },
    {
        'filename': 'sample_05_manual_review.pdf',
        'lines': [
            'Name: LUCY',
            'Signature: ____',
            'Witness: JOSE RAMIREZ'
        ]
    }
]

for sample in samples:
    file_path = OUTPUT / sample['filename']
    c = canvas.Canvas(str(file_path), pagesize=(595, 842))
    y = 760
    for line in sample['lines']:
        c.drawString(70, y, line)
        y -= 30
    c.save()

print(f'Generated {len(samples)} sample PDFs in {OUTPUT}')
