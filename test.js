fetch('http://localhost:3000/api/inventory-alert', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sku: 'TEST-01',
    itemName: 'Wireless Mouse',
    currentStock: 3
  })
})
.then(res => res.json())
.then(data => console.log('Server Response:', data))
.catch(err => console.error('Error:', err));