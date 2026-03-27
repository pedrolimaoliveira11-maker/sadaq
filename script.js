let clientes = JSON.parse(localStorage.getItem('db_clientes_spfc')) || [];
let vendas = JSON.parse(localStorage.getItem('db_vendas_spfc')) || [];

document.getElementById('form-cliente').addEventListener('submit', function(e) {
    e.preventDefault();
    const nome = document.getElementById('nome-cliente').value.trim();
    if(nome) {
        clientes.push(nome);
        localStorage.setItem('db_clientes_spfc', JSON.stringify(clientes));
        atualizarClientes();
        document.getElementById('form-cliente').reset();
    }
});

function atualizarClientes() {
    const lista = document.getElementById('lista-clientes-simples');
    const select = document.getElementById('select-venda-cliente');
    lista.innerHTML = '';
    select.innerHTML = '<option value="">Selecione um cliente...</option>';
    clientes.forEach((c, i) => {
        lista.innerHTML += `<tr><td>${c}</td><td><button onclick="removerCliente(${i})">Remover</button></td></tr>`;
        select.innerHTML += `<option value="${c}">${c}</option>`;
    });
}

function removerCliente(index) {
    clientes.splice(index, 1);
    localStorage.setItem('db_clientes_spfc', JSON.stringify(clientes));
    atualizarClientes();
}

document.getElementById('form-venda').addEventListener('submit', function(e) {
    e.preventDefault();
    const cliente = document.getElementById('select-venda-cliente').value;
    const produto = document.getElementById('prod-nome').value.trim();
    const preco = parseFloat(document.getElementById('prod-preco').value);

    if(cliente && produto && preco > 0) {
        const venda = {
            data: new Date().toLocaleString(),
            cliente,
            produto,
            preco
        };
        vendas.push(venda);
