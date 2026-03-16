const form = document.getElementById('form-cadastro');
const corpoTabela = document.getElementById('corpo-tabela');

document.addEventListener('DOMContentLoaded', exibirClientes);

form.addEventListener('submit', function(e) {
    e.preventDefault();
    const cliente = {
        id: Date.now(),
        nome: document.getElementById('nome').value,
        email: document.getElementById('email').value,
        telefone: document.getElementById('telefone').value
    };
    
    let clientes = JSON.parse(localStorage.getItem('clientes')) || [];
    clientes.push(cliente);
    localStorage.setItem('clientes', JSON.stringify(clientes));
    
    form.reset();
    exibirClientes();
});

function exibirClientes() {
    const clientes = JSON.parse(localStorage.getItem('clientes')) || [];
    renderizarTabela(clientes);
}

// Função central de renderização
function renderizarTabela(lista) {
    corpoTabela.innerHTML = '';
    lista.forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${c.nome}</td>
            <td>${c.email}</td>
            <td>${c.telefone}</td>
            <td><button class="btn-excluir" onclick="removerCliente(${c.id})">Excluir</button></td>
        `;
        corpoTabela.appendChild(tr);
    });
}

// LÓGICA DE BUSCA
function filtrarClientes() {
    const termo = document.getElementById('busca').value.toLowerCase();
    const clientes = JSON.parse(localStorage.getItem('clientes')) || [];
    
    const filtrados = clientes.filter(c => 
        c.nome.toLowerCase().includes(termo) || 
        c.email.toLowerCase().includes(termo)
    );
    
    renderizarTabela(filtrados);
}

function removerCliente(id) {
    let clientes = JSON.parse(localStorage.getItem('clientes')) || [];
    clientes = clientes.filter(c => c.id !== id);
    localStorage.setItem('clientes', JSON.stringify(clientes));
    exibirClientes();
}

// EXPORTAR PARA EXCEL (CSV)
document.getElementById('btn-exportar').addEventListener('click', () => {
    const clientes = JSON.parse(localStorage.getItem('clientes')) || [];
    if(clientes.length === 0) return alert("Lista vazia!");

    let csv = "\ufeffNome;E-mail;Telefone\n"; // \ufeff resolve problemas de acentuação no Excel
    clientes.forEach(c => csv += `${c.nome};${c.email};${c.telefone}\n`);

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "clientes.csv";
    link.click();
});
